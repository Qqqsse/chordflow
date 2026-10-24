import { isVerifiedCompatibility } from '@chordflow/chart-schema';
import { ok } from '@/lib/api/envelope';
import { apiRoute } from '@/lib/api/handler';
import { canViewRevision } from '@/server/access';
import { getPrincipal } from '@/server/auth/principal';
import { getCatalog } from '@/server/catalog';
import { requireVisibleArrangement } from '@/server/catalog/lookups';
import { toArrangementSummary, toWorkSummary } from '@/server/catalog/views';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(
  async (request: Request, { params }: { params: Promise<{ id: string }> }, requestId) => {
    const repo = getCatalog();
    const principal = await getPrincipal(request);
    const arrangement = await requireVisibleArrangement(repo, principal, (await params).id);
    const ownerUserId = await repo.getArrangementOwnerId(arrangement.id);
    const [work, revisions, mappings] = await Promise.all([
      repo.getWork(arrangement.workId),
      repo.listRevisions(arrangement.id),
      repo.listCompatibilities({ arrangementId: arrangement.id }),
    ]);
    if (work === null) throw new Error('arrangement without work');
    return ok(
      {
        arrangement: toArrangementSummary(arrangement),
        rights: arrangement.rights,
        work: await toWorkSummary(repo, work),
        revisions: revisions
          .filter((r) => canViewRevision(principal, { ...arrangement, ownerUserId }, r))
          .map((r) => ({
            id: r.id,
            revision: r.revision,
            status: r.status,
            origin: r.origin,
            createdAt: r.createdAt,
          })),
        mappings: mappings.map((m) => ({
          arrangementId: m.arrangementId,
          recordingId: m.recordingId,
          provenance: m.provenance,
          verified: isVerifiedCompatibility(m.provenance),
          recordedKey: m.recordedKey,
          transposeSemitones: m.transposeSemitones,
        })),
      },
      requestId,
    );
  },
);
