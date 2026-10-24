import {
  isVerifiedCompatibility,
  type Arrangement,
  type ArrangementSummary,
  type RecordingSummary,
  type SearchData,
  type SearchHit,
  type Work,
} from '@chordflow/chart-schema';
import { z } from 'zod';
import { canViewArrangement, type Principal } from '../access';
import { parseSourceUrl } from '../source-url';
import type { CatalogRepository } from './repository';
import { MAX_QUERY_LENGTH, normalizeSearchText } from './search-text';

/*
 * Assembles API views from the repository, applying access rules on the
 * server. Hidden arrangements are omitted entirely (no existence leak).
 */

export async function visibleArrangement(
  repo: CatalogRepository,
  principal: Principal,
  arrangement: Arrangement,
): Promise<boolean> {
  const ownerUserId = await repo.getArrangementOwnerId(arrangement.id);
  return canViewArrangement(principal, { ...arrangement, ownerUserId });
}

export function toArrangementSummary(arrangement: Arrangement): ArrangementSummary {
  return {
    id: arrangement.id,
    workId: arrangement.workId,
    name: arrangement.name,
    variant: arrangement.variant,
    visibility: arrangement.visibility,
    publishedRevisionId: arrangement.publishedRevisionId,
    hasPublishedChart: arrangement.publishedRevisionId !== null,
    attribution: arrangement.rights.attribution,
  };
}

export async function toWorkSummary(repo: CatalogRepository, work: Work) {
  const credits = await Promise.all(
    work.credits.map(async (c) => {
      const artist = await repo.getArtist(c.artistId);
      return { role: c.role, artist: { id: c.artistId, name: artist?.name ?? '' } };
    }),
  );
  return {
    id: work.id,
    title: work.title,
    titleAliases: work.titleAliases,
    language: work.language,
    credits,
  };
}

export async function visibleArrangementsForWork(
  repo: CatalogRepository,
  principal: Principal,
  workId: string,
): Promise<Arrangement[]> {
  const all = await repo.listArrangementsForWork(workId);
  const flags = await Promise.all(all.map((a) => visibleArrangement(repo, principal, a)));
  return all.filter((_, i) => flags[i]);
}

export async function recordingSummaries(
  repo: CatalogRepository,
  workId: string,
  visibleArrangementIds: ReadonlySet<string>,
): Promise<RecordingSummary[]> {
  const recordings = await repo.listRecordingsForWork(workId);
  return Promise.all(
    recordings.map(async (recording) => {
      const [performers, mappings] = await Promise.all([
        Promise.all(
          recording.artistCredits.map(async (c) => ({
            id: c.artistId,
            name: (await repo.getArtist(c.artistId))?.name ?? '',
          })),
        ),
        repo.listCompatibilities({ recordingId: recording.id }),
      ]);
      return {
        id: recording.id,
        workId: recording.workId,
        title: recording.title,
        kind: recording.kind,
        performers,
        mappings: mappings
          .filter((m) => visibleArrangementIds.has(m.arrangementId))
          .map((m) => ({
            arrangementId: m.arrangementId,
            recordingId: m.recordingId,
            provenance: m.provenance,
            verified: isVerifiedCompatibility(m.provenance),
            recordedKey: m.recordedKey,
            transposeSemitones: m.transposeSemitones,
          })),
      };
    }),
  );
}

export async function workHit(
  repo: CatalogRepository,
  principal: Principal,
  work: Work,
): Promise<SearchHit> {
  const arrangements = await visibleArrangementsForWork(repo, principal, work.id);
  const ids = new Set(arrangements.map((a) => a.id));
  const [summary, recordings] = await Promise.all([
    toWorkSummary(repo, work),
    recordingSummaries(repo, work.id, ids),
  ]);
  return { work: summary, recordings, arrangements: arrangements.map(toArrangementSummary) };
}

const CursorSchema = z.strictObject({ q: z.string(), o: z.int().min(0).max(10_000) });

export function encodeCursor(query: string, offset: number): string {
  return Buffer.from(JSON.stringify({ q: query, o: offset }), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string, query: string): number | null {
  try {
    const parsed = CursorSchema.safeParse(
      JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
    );
    return parsed.success && parsed.data.q === query ? parsed.data.o : null;
  } catch {
    return null;
  }
}

export interface SearchFailure {
  error: 'INVALID_QUERY';
  message: string;
}

/**
 * Catalog search (SPEC §9): text queries match titles, aliases and artists;
 * supported source URLs are resolved to known sources without fetching;
 * unsupported URLs are rejected rather than fetched.
 */
export async function searchCatalog(
  repo: CatalogRepository,
  principal: Principal,
  rawQuery: string,
  options: { limit: number; cursor: string | null },
): Promise<SearchData | SearchFailure> {
  const query = rawQuery.trim();
  if (query === '' || query.length > MAX_QUERY_LENGTH) {
    return { error: 'INVALID_QUERY', message: `query must be 1–${MAX_QUERY_LENGTH} characters` };
  }
  const source = parseSourceUrl(query);
  if (source.kind === 'unsupported') {
    return {
      error: 'INVALID_QUERY',
      message: `unsupported source URL (${source.reason}); URLs are never fetched`,
    };
  }
  if (source.kind === 'source') {
    const known = await repo.findSourceByPlatformId(source.platform, source.platformSourceId);
    const recordings = known ? await repo.listRecordingsForSource(known.id) : [];
    const workIds = [...new Set(recordings.map((r) => r.workId))];
    const works = (await Promise.all(workIds.map((id) => repo.getWork(id)))).filter(
      (w): w is Work => w !== null,
    );
    return {
      query,
      source: {
        platform: source.platform,
        platformSourceId: source.platformSourceId,
        matchedSourceId: known?.id ?? null,
      },
      items: await Promise.all(works.map((w) => workHit(repo, principal, w))),
      nextCursor: null,
    };
  }

  const normalized = normalizeSearchText(query);
  if (normalized === '') {
    return { error: 'INVALID_QUERY', message: 'query has no searchable characters' };
  }
  const offset = options.cursor === null ? 0 : decodeCursor(options.cursor, normalized);
  if (offset === null)
    return { error: 'INVALID_QUERY', message: 'cursor does not match this query' };
  const page = await repo.searchWorks(normalized, { limit: options.limit, offset });
  return {
    query,
    source: null,
    items: await Promise.all(page.works.map((w) => workHit(repo, principal, w))),
    nextCursor: page.hasMore ? encodeCursor(normalized, offset + options.limit) : null,
  };
}
