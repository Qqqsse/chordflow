import {
  LYRICS_RIGHTS_FOR_GENERATION,
  canAnalyzeSource,
  rightsAllowVisibility,
  type ArtifactManifestEntry,
  type ChartRevision,
  type GenerationJobCreateRequest,
  type JobEvent,
  type QualityReport,
} from '@chordflow/chart-schema';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { ApiProblem } from '@/lib/api/handler';
import { publishRevision } from '../catalog/editor';
import { toApiProblem } from '../catalog/editor-errors';
import { createPgCatalog } from '../catalog/pg-repository';
import type { Database } from '../db/client';
import {
  ACTIVE_JOB_STATES,
  generationArtifacts,
  generationJobEvents,
  generationJobs,
} from '../db/jobs-schema';
import * as t from '../db/schema';
import { sha256Of } from './canonical';
import {
  isUniqueViolation,
  loadJob,
  lockJob,
  newJobId,
  recordInitialEvent,
  releaseLease,
  transition,
} from './store';
import { toJobEvent, type JobRow } from './views';

/*
 * User-facing side of the generation coordinator (SPEC §10). Submissions are
 * rights-checked, idempotent per (user, key), deduplicated against equivalent
 * active requests and quota-limited; publication goes through review.
 */

export interface JobUser {
  userId: string;
  role: 'member' | 'admin';
}

/** Jobs that still need a worker; drafts awaiting review do not count against the quota. */
const QUOTA_STATES = ['created', 'validated', 'queued', 'leased', 'running', 'failed_retryable'];
export const MAX_ACTIVE_JOBS: Record<JobUser['role'], number> = { member: 3, admin: 10 };
const CANCELLABLE = new Set(QUOTA_STATES);

/** Same text, same fingerprint: line endings and Unicode normalization are not differences. */
export function normalizeRequest(request: GenerationJobCreateRequest): GenerationJobCreateRequest {
  if (request.input.kind !== 'reference_lyrics') return request;
  const lyrics = request.input.lyrics.replace(/\r\n?/g, '\n').normalize('NFC').trim();
  return { ...request, input: { ...request.input, lyrics } };
}

export function requestFingerprint(request: GenerationJobCreateRequest): string {
  const { idempotencyKey: _key, ...rest } = request;
  return sha256Of(rest);
}

async function findReusable(
  db: Database,
  userId: string,
  key: string,
  fingerprint: string,
): Promise<JobRow | null> {
  const [byKey] = await db
    .select()
    .from(generationJobs)
    .where(and(eq(generationJobs.createdBy, userId), eq(generationJobs.idempotencyKey, key)));
  if (byKey) {
    if (byKey.requestFingerprint !== fingerprint) {
      throw new ApiProblem(
        409,
        'IDEMPOTENCY_CONFLICT',
        'This idempotency key was already used for a different request',
      );
    }
    return byKey;
  }
  const [active] = await db
    .select()
    .from(generationJobs)
    .where(
      and(
        eq(generationJobs.createdBy, userId),
        eq(generationJobs.requestFingerprint, fingerprint),
        inArray(generationJobs.state, [...ACTIVE_JOB_STATES]),
      ),
    );
  return active ?? null;
}

async function assertSubmittable(db: Database, request: GenerationJobCreateRequest) {
  const { target, input } = request;
  if (!rightsAllowVisibility(target.rights, target.visibility)) {
    throw new ApiProblem(
      422,
      'VALIDATION_FAILED',
      `content rights do not permit "${target.visibility}" visibility`,
    );
  }
  if (input.kind === 'reference_lyrics') {
    if (!(LYRICS_RIGHTS_FOR_GENERATION as readonly string[]).includes(target.rights.lyrics)) {
      throw new ApiProblem(
        422,
        'SOURCE_NOT_AUTHORIZED',
        'Declare the lyric rights (self-written, public domain, licensed or permitted) first',
      );
    }
  } else {
    const source = await createPgCatalog(db).getSource(input.sourceReferenceId);
    if (source === null || !canAnalyzeSource(source)) {
      // Unknown and unauthorised sources look the same to the caller.
      throw new ApiProblem(
        422,
        'SOURCE_NOT_AUTHORIZED',
        'This source has no audio-analysis permission; a public link is not permission',
      );
    }
  }
}

async function resolveTitle(db: Database, target: GenerationJobCreateRequest['target']) {
  if (!('id' in target.work)) return target.work.title;
  const [work] = await db
    .select({ title: t.works.title })
    .from(t.works)
    .where(eq(t.works.id, target.work.id));
  if (!work) throw new ApiProblem(422, 'VALIDATION_FAILED', 'Target work was not found');
  return work.title;
}

export async function submitJob(
  db: Database,
  user: JobUser,
  raw: GenerationJobCreateRequest,
): Promise<{ row: JobRow; reused: boolean }> {
  const request = normalizeRequest(raw);
  const fingerprint = requestFingerprint(request);
  const existing = await findReusable(db, user.userId, request.idempotencyKey, fingerprint);
  if (existing) return { row: existing, reused: true };
  await assertSubmittable(db, request);
  const title = await resolveTitle(db, request.target);
  try {
    return await db.transaction(async (tx) => {
      // Serialises one user's submissions so the quota and dedupe checks are exact.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`jobs:${user.userId}`}))`);
      const again = await findReusable(tx, user.userId, request.idempotencyKey, fingerprint);
      if (again) return { row: again, reused: true };
      const [active] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(generationJobs)
        .where(
          and(
            eq(generationJobs.createdBy, user.userId),
            inArray(generationJobs.state, QUOTA_STATES),
          ),
        );
      if ((active?.count ?? 0) >= MAX_ACTIVE_JOBS[user.role]) {
        throw new ApiProblem(429, 'QUOTA_EXCEEDED', 'Too many unfinished generation jobs', {
          limit: MAX_ACTIVE_JOBS[user.role],
        });
      }
      const id = newJobId();
      await tx.insert(generationJobs).values({
        id,
        createdBy: user.userId,
        idempotencyKey: request.idempotencyKey,
        requestFingerprint: fingerprint,
        request,
        title,
        state: 'created',
      });
      await recordInitialEvent(tx, id);
      const validated = await transition(
        tx,
        { id, state: 'created', attempt: 0 },
        'validated',
        'user',
      );
      await transition(tx, validated, 'queued', 'system');
      const row = await loadJob(tx, id);
      if (!row) throw new Error('job vanished inside its own transaction');
      return { row, reused: false };
    });
  } catch (error) {
    // A concurrent identical submission won the race: return its job.
    if (isUniqueViolation(error)) {
      const winner = await findReusable(db, user.userId, request.idempotencyKey, fingerprint);
      if (winner) return { row: winner, reused: true };
    }
    throw error;
  }
}

function assertCanSee(row: JobRow | null, user: JobUser): asserts row is JobRow {
  if (row === null || (user.role !== 'admin' && row.createdBy !== user.userId)) {
    throw new ApiProblem(404, 'JOB_NOT_FOUND', 'Generation job was not found');
  }
}

export async function getJob(db: Database, jobId: string, user: JobUser): Promise<JobRow> {
  const row = await loadJob(db, jobId);
  assertCanSee(row, user);
  return row;
}

export async function listJobs(db: Database, user: JobUser): Promise<JobRow[]> {
  return db
    .select()
    .from(generationJobs)
    .where(user.role === 'admin' ? undefined : eq(generationJobs.createdBy, user.userId))
    .orderBy(desc(generationJobs.createdAt), desc(generationJobs.id))
    .limit(50);
}

export async function listJobEvents(
  db: Database,
  jobId: string,
  user: JobUser,
): Promise<JobEvent[]> {
  if (user.role !== 'admin') return [];
  const rows = await db
    .select()
    .from(generationJobEvents)
    .where(eq(generationJobEvents.jobId, jobId))
    .orderBy(asc(generationJobEvents.id));
  return rows.map(toJobEvent);
}

export interface JobResult {
  row: JobRow;
  revision: ChartRevision;
  quality: QualityReport;
  processor: { id: string; version: string };
  artifacts: ArtifactManifestEntry[];
}

export async function getJobResult(db: Database, jobId: string, user: JobUser): Promise<JobResult> {
  const row = await getJob(db, jobId, user);
  const revision =
    row.resultRevisionId === null
      ? null
      : await createPgCatalog(db).getRevisionById(row.resultRevisionId);
  if (
    revision === null ||
    row.quality === null ||
    row.processorId === null ||
    row.processorVersion === null
  ) {
    throw new ApiProblem(404, 'RESULT_NOT_AVAILABLE', 'No draft is available for this job yet');
  }
  const artifacts = await db
    .select({ entry: generationArtifacts.entry })
    .from(generationArtifacts)
    .where(eq(generationArtifacts.jobId, jobId))
    .orderBy(asc(generationArtifacts.position));
  return {
    row,
    revision,
    quality: row.quality,
    processor: { id: row.processorId, version: row.processorVersion },
    artifacts: artifacts.map((a) => a.entry),
  };
}

/** Cancels a job that has not produced a draft (drafts are rejected through review). */
export async function cancelJob(db: Database, jobId: string, user: JobUser): Promise<JobRow> {
  await db.transaction(async (tx) => {
    const row = await lockJob(tx, jobId);
    assertCanSee(row, user);
    if (row.state === 'cancelled') return;
    if (!CANCELLABLE.has(row.state)) {
      throw new ApiProblem(409, 'JOB_STATE_CONFLICT', `A ${row.state} job cannot be cancelled`);
    }
    await transition(tx, row, 'cancelled', user.role === 'admin' ? 'admin' : 'user', {
      set:
        row.leaseToken === null
          ? { progress: null }
          : { ...releaseLease(row.leaseToken), progress: null },
      code: 'CANCELLED',
    });
  });
  return getJob(db, jobId, user);
}

/** True when `revisionId` is the draft itself or descends from it through parent links. */
async function derivesFrom(db: Database, revisionId: string, draftId: string): Promise<boolean> {
  let current: string | null = revisionId;
  for (let hops = 0; current !== null && hops < 50; hops += 1) {
    if (current === draftId) return true;
    const [row] = await db
      .select({ parent: t.chartRevisions.parentRevisionId })
      .from(t.chartRevisions)
      .where(eq(t.chartRevisions.id, current));
    current = row?.parent ?? null;
  }
  return false;
}

export type ReviewAction = { action: 'publish'; revisionId: string } | { action: 'reject' };

export async function reviewJob(
  db: Database,
  jobId: string,
  admin: JobUser,
  review: ReviewAction,
): Promise<{ row: JobRow; publishedRevisionId: string | null }> {
  const published = await db.transaction(async (tx) => {
    const row = await lockJob(tx, jobId);
    assertCanSee(row, admin);
    const { resultArrangementId: arrangementId, resultRevisionId: draftId } = row;
    if (arrangementId === null || draftId === null) {
      throw new ApiProblem(409, 'JOB_STATE_CONFLICT', 'The job has no draft to review');
    }
    if (review.action === 'reject') {
      if (row.state === 'cancelled') return null;
      if (row.state !== 'needs_review') {
        throw new ApiProblem(409, 'JOB_STATE_CONFLICT', `A ${row.state} job cannot be rejected`);
      }
      await tx
        .update(t.chartRevisions)
        .set({ status: 'rejected' })
        .where(
          and(
            eq(t.chartRevisions.id, draftId),
            inArray(t.chartRevisions.status, ['draft', 'needs_review']),
          ),
        );
      await transition(tx, row, 'cancelled', 'admin', { code: 'REVIEW_REJECTED' });
      return null;
    }
    if (row.state === 'published') {
      const [arrangement] = await tx
        .select({ pointer: t.arrangements.publishedRevisionId })
        .from(t.arrangements)
        .where(eq(t.arrangements.id, arrangementId));
      if (arrangement?.pointer === review.revisionId) return review.revisionId;
      throw new ApiProblem(409, 'JOB_STATE_CONFLICT', 'The job was already published');
    }
    if (row.state !== 'needs_review') {
      throw new ApiProblem(409, 'JOB_STATE_CONFLICT', `A ${row.state} job cannot be published`);
    }
    if (!(await derivesFrom(tx, review.revisionId, draftId))) {
      throw new ApiProblem(
        422,
        'PUBLISH_REJECTED',
        'Only the draft or a revision derived from it can be published from this job',
      );
    }
    await publishRevision(tx, arrangementId, review.revisionId).catch(toApiProblem);
    await transition(tx, row, 'published', 'admin', { code: null });
    return review.revisionId;
  });
  return { row: await getJob(db, jobId, admin), publishedRevisionId: published };
}
