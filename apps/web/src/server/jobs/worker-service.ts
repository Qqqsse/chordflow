import { randomBytes } from 'node:crypto';
import {
  CHART_DOCUMENT_SCHEMA_VERSION,
  GENERATION_CONTRACT_VERSION,
  checkArtifactManifest,
  checkQualityTargets,
  validateChartDocument,
  type ClaimedJob,
  type ProcessorMode,
  type QualityReport,
  type ValidationIssue,
  type WorkerClaimRequestSchema,
  type WorkerCompleteRequest,
  type WorkerFailRequestSchema,
  type WorkerHeartbeatRequestSchema,
} from '@chordflow/chart-schema';
import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { ApiProblem } from '@/lib/api/handler';
import { EditorError, createArrangement, createRevision } from '../catalog/editor';
import type { Database } from '../db/client';
import { generationArtifacts, generationJobs } from '../db/jobs-schema';
import { sanitizeWorkerMessage, sha256Of } from './canonical';
import { lockJob, releaseLease, touchWorker, transition } from './store';
import type { JobRow } from './views';

/*
 * Worker side of the coordinator (SPEC §10 "Idempotency and worker safety").
 * A lease is (owner, token) on the row; any report must present both. Expired
 * leases are swept back to the queue at claim time, and a completion is
 * recorded once: repeating it returns the same outcome.
 */

type ClaimRequest = z.infer<typeof WorkerClaimRequestSchema>;
type HeartbeatRequest = z.infer<typeof WorkerHeartbeatRequestSchema>;
type FailRequest = z.infer<typeof WorkerFailRequestSchema>;

const iso = (value: string | null): string | null =>
  value === null ? null : new Date(value).toISOString();

/** Exponential retry backoff: base · 2^(attempt−1), capped at ten minutes. */
export function retryBackoffSeconds(attempt: number, baseSeconds: number): number {
  return Math.min(baseSeconds * 2 ** Math.max(0, attempt - 1), 600);
}

function retryBaseSeconds(): number {
  const value = Number(process.env.JOB_RETRY_BASE_SECONDS ?? '10');
  return Number.isFinite(value) && value >= 0 ? value : 10;
}

const secondsFromNow = (seconds: number) =>
  sql<string>`now() + (${Math.round(seconds)}::int * interval '1 second')`;

/** Requeues (or, out of attempts, fails) jobs whose worker stopped reporting. */
export async function sweepExpiredLeases(tx: Database): Promise<number> {
  const expired = await tx
    .select()
    .from(generationJobs)
    .where(
      and(
        inArray(generationJobs.state, ['leased', 'running']),
        lt(generationJobs.leaseExpiresAt, sql`now()`),
      ),
    )
    .for('update', { skipLocked: true });
  for (const row of expired) {
    const released = releaseLease(row.leaseToken ?? '');
    if (row.attempt >= row.maxAttempts) {
      await transition(tx, row, 'failed_terminal', 'system', {
        set: {
          ...released,
          progress: null,
          errorCode: 'RETRY_LIMIT_EXCEEDED',
          errorMessage: 'The worker stopped reporting on every attempt',
          errorRetryable: false,
        },
        code: 'LEASE_EXPIRED',
      });
    } else {
      await transition(tx, row, 'queued', 'system', {
        set: {
          ...released,
          progress: null,
          notBefore: null,
          errorCode: 'LEASE_EXPIRED',
          errorMessage: 'The worker stopped reporting; the job was requeued',
          errorRetryable: true,
        },
        code: 'LEASE_EXPIRED',
      });
    }
  }
  return expired.length;
}

export async function claimJob(db: Database, request: ClaimRequest): Promise<ClaimedJob | null> {
  return db.transaction(async (tx) => {
    await touchWorker(tx, request.workerId, request.workerVersion);
    await sweepExpiredLeases(tx);
    const [row] = await tx
      .select()
      .from(generationJobs)
      .where(
        and(
          eq(generationJobs.state, 'queued'),
          or(isNull(generationJobs.notBefore), lte(generationJobs.notBefore, sql`now()`)),
          inArray(sql`${generationJobs.request}->'options'->>'processor'`, request.processors),
        ),
      )
      .orderBy(asc(generationJobs.createdAt), asc(generationJobs.id))
      .limit(1)
      .for('update', { skipLocked: true });
    if (!row) return null;
    const leaseToken = `lease_${randomBytes(16).toString('hex')}`;
    await transition(tx, row, 'leased', 'worker', {
      set: {
        attempt: row.attempt + 1,
        leaseOwner: request.workerId,
        leaseToken,
        leaseSeconds: request.leaseSeconds,
        leaseExpiresAt: secondsFromNow(request.leaseSeconds),
        notBefore: null,
        progress: null,
      },
    });
    const [claimed] = await tx
      .select({ leaseExpiresAt: generationJobs.leaseExpiresAt })
      .from(generationJobs)
      .where(eq(generationJobs.id, row.id));
    return {
      id: row.id,
      contractVersion: GENERATION_CONTRACT_VERSION,
      attempt: row.attempt + 1,
      maxAttempts: row.maxAttempts,
      leaseToken,
      leaseExpiresAt: iso(claimed?.leaseExpiresAt ?? null) ?? new Date().toISOString(),
      title: row.title,
      input: row.request.input,
      options: row.request.options,
    };
  });
}

/** The lease is valid while the job is leased/running under this exact owner and token. */
function assertLease(row: JobRow | null, workerId: string, token: string): asserts row is JobRow {
  if (row === null) throw new ApiProblem(404, 'JOB_NOT_FOUND', 'Generation job was not found');
  const active = row.state === 'leased' || row.state === 'running';
  if (!active || row.leaseToken !== token || row.leaseOwner !== workerId) {
    throw new ApiProblem(
      409,
      'LEASE_LOST',
      row.state === 'cancelled'
        ? 'The job was cancelled; stop working on it'
        : 'The lease is no longer held by this worker',
    );
  }
}

export async function heartbeatJob(
  db: Database,
  jobId: string,
  request: HeartbeatRequest,
): Promise<{ leaseExpiresAt: string }> {
  return db.transaction(async (tx) => {
    const row = await lockJob(tx, jobId);
    assertLease(row, request.workerId, request.leaseToken);
    await touchWorker(tx, request.workerId);
    const extend = secondsFromNow(row.leaseSeconds ?? 60);
    if (row.state === 'leased') {
      await transition(tx, row, 'running', 'worker', {
        set: { progress: request.progress, leaseExpiresAt: extend },
      });
    } else {
      await tx
        .update(generationJobs)
        .set({ progress: request.progress, leaseExpiresAt: extend, updatedAt: sql`now()` })
        .where(eq(generationJobs.id, jobId));
    }
    const [updated] = await tx
      .select({ leaseExpiresAt: generationJobs.leaseExpiresAt })
      .from(generationJobs)
      .where(eq(generationJobs.id, jobId));
    return { leaseExpiresAt: iso(updated?.leaseExpiresAt ?? null) ?? new Date().toISOString() };
  });
}

/** What each processor can honestly claim as evidence; the mock chain never hears audio. */
const ANALYSIS_BY_PROCESSOR: Record<ProcessorMode, QualityReport['analysis']> = {
  mock: 'synthetic_mock',
};

/** Contract checks a completion must pass before anything is stored. */
export function validateCompletion(row: JobRow, request: WorkerCompleteRequest): ValidationIssue[] {
  const { document, quality } = request.draft;
  const options = row.request.options;
  const issues: ValidationIssue[] = [];
  const mismatch = (path: (string | number)[], message: string) => {
    issues.push({ code: 'REFERENCE_MISMATCH', path, message });
  };
  if (request.processor.id !== options.processor) {
    mismatch(['processor', 'id'], `job requested the "${options.processor}" processor`);
  }
  if (quality.analysis !== ANALYSIS_BY_PROCESSOR[options.processor]) {
    mismatch(
      ['draft', 'quality', 'analysis'],
      `"${options.processor}" drafts are "${ANALYSIS_BY_PROCESSOR[options.processor]}"`,
    );
  }
  if (quality.llm.provider !== options.llmReview) {
    mismatch(['draft', 'quality', 'llm', 'provider'], `job requested "${options.llmReview}"`);
  }
  if (options.llmReview === 'disabled' && quality.suggestions.length > 0) {
    mismatch(['draft', 'quality', 'suggestions'], 'LLM review was disabled for this job');
  }
  const chart = validateChartDocument({
    ...document,
    schemaVersion: CHART_DOCUMENT_SCHEMA_VERSION,
    chartRevisionId: 'rev_pending',
    arrangementId: 'arr_pending',
    revision: 1,
  });
  for (const issue of chart.issues) {
    issues.push({ ...issue, path: ['draft', 'document', ...issue.path] });
  }
  for (const issue of checkQualityTargets(document, quality)) {
    issues.push({ ...issue, path: ['draft', 'quality', ...issue.path] });
  }
  for (const issue of checkArtifactManifest(request.artifacts)) {
    issues.push({ ...issue, path: ['artifacts', ...issue.path] });
  }
  request.artifacts.forEach((entry, i) => {
    if (!entry.storagePath.startsWith(`jobs/${row.id}/`)) {
      mismatch(['artifacts', i, 'storagePath'], `artifacts must be stored under jobs/${row.id}/`);
    }
  });
  return issues;
}

export interface CompletionOutcome {
  jobId: string;
  arrangementId: string;
  revisionId: string;
  replayed: boolean;
}

export async function completeJob(
  db: Database,
  jobId: string,
  request: WorkerCompleteRequest,
): Promise<CompletionOutcome> {
  const digest = sha256Of(request);
  const outcome = await db.transaction(async (tx) => {
    const row = await lockJob(tx, jobId);
    if (row?.completionDigest != null) {
      if (
        row.completionDigest === digest &&
        row.resultArrangementId !== null &&
        row.resultRevisionId !== null
      ) {
        return {
          kind: 'ok' as const,
          jobId,
          arrangementId: row.resultArrangementId,
          revisionId: row.resultRevisionId,
          replayed: true,
        };
      }
      throw new ApiProblem(409, 'LEASE_LOST', 'The job was already completed with another result');
    }
    assertLease(row, request.workerId, request.leaseToken);
    await touchWorker(tx, request.workerId);
    const released = releaseLease(request.leaseToken);
    const issues = validateCompletion(row, request);
    const reject = async (found: ValidationIssue[]) => {
      await transition(tx, row, 'failed_terminal', 'system', {
        set: {
          ...released,
          progress: null,
          errorCode: 'ARTIFACT_VALIDATION_FAILED',
          errorMessage: 'The draft or artifact manifest failed validation',
          errorRetryable: false,
        },
        code: 'ARTIFACT_VALIDATION_FAILED',
      });
      return { kind: 'invalid' as const, issues: found.slice(0, 50) };
    };
    if (issues.length > 0) return reject(issues);

    const running = row.state === 'leased' ? await transition(tx, row, 'running', 'worker') : row;
    let created: { arrangementId: string };
    try {
      created = await createArrangement(tx, row.request.target, row.createdBy);
    } catch (error) {
      if (!(error instanceof EditorError)) throw error;
      return reject([{ code: 'UNKNOWN_REFERENCE', path: ['target'], message: error.message }]);
    }
    const { schemaVersion: _version, ...content } = request.draft.document;
    const revision = await createRevision(tx, {
      arrangementId: created.arrangementId,
      document: content,
      origin: 'ai_draft',
      parentRevisionId: null,
      createdBy: row.createdBy,
      initialStatus: 'needs_review',
    });
    await tx
      .insert(generationArtifacts)
      .values(request.artifacts.map((entry, position) => ({ jobId, position, entry })));
    const ready = await transition(tx, running, 'draft_ready', 'worker', {
      set: {
        ...released,
        progress: { stage: 'draft_producer', fraction: 1 },
        completionDigest: digest,
        quality: request.draft.quality,
        processorId: request.processor.id,
        processorVersion: request.processor.version,
        resultArrangementId: created.arrangementId,
        resultRevisionId: revision.id,
        errorCode: null,
        errorMessage: null,
        errorRetryable: null,
      },
    });
    await transition(tx, ready, 'needs_review', 'system');
    return {
      kind: 'ok' as const,
      jobId,
      arrangementId: created.arrangementId,
      revisionId: revision.id,
      replayed: false,
    };
  });
  if (outcome.kind === 'invalid') {
    throw new ApiProblem(
      422,
      'ARTIFACT_VALIDATION_FAILED',
      'The completion failed validation; the job was failed terminally',
      { issues: outcome.issues },
    );
  }
  const { kind: _kind, ...result } = outcome;
  return result;
}

export async function failJob(
  db: Database,
  jobId: string,
  request: FailRequest,
): Promise<{
  state: 'queued' | 'failed_terminal';
  nextAttemptAt: string | null;
  replayed: boolean;
}> {
  return db.transaction(async (tx) => {
    const row = await lockJob(tx, jobId);
    if (
      row !== null &&
      row.releasedLeaseToken === request.leaseToken &&
      row.errorCode === request.error.code &&
      (row.state === 'queued' || row.state === 'failed_terminal')
    ) {
      return { state: row.state, nextAttemptAt: iso(row.notBefore), replayed: true };
    }
    assertLease(row, request.workerId, request.leaseToken);
    await touchWorker(tx, request.workerId);
    const set = {
      ...releaseLease(request.leaseToken),
      progress: null,
      errorCode: request.error.code,
      errorMessage: sanitizeWorkerMessage(request.error.message),
      errorRetryable: request.error.retryable,
    };
    if (request.error.retryable && row.attempt < row.maxAttempts) {
      const failed = await transition(tx, row, 'failed_retryable', 'worker', {
        set,
        code: request.error.code,
      });
      const backoff = retryBackoffSeconds(row.attempt, retryBaseSeconds());
      await transition(tx, failed, 'queued', 'system', {
        set: { notBefore: secondsFromNow(backoff) },
        code: 'RETRY_SCHEDULED',
      });
      const [queued] = await tx
        .select({ notBefore: generationJobs.notBefore })
        .from(generationJobs)
        .where(eq(generationJobs.id, jobId));
      return {
        state: 'queued' as const,
        nextAttemptAt: iso(queued?.notBefore ?? null),
        replayed: false,
      };
    }
    await transition(tx, row, 'failed_terminal', 'worker', {
      set,
      code: request.error.retryable ? 'RETRY_LIMIT_EXCEEDED' : request.error.code,
    });
    return { state: 'failed_terminal' as const, nextAttemptAt: null, replayed: false };
  });
}
