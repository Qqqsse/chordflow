import {
  JobErrorCodeSchema,
  JobStateSchema,
  toExternalJobStatus,
  type GenerationJobView,
  type JobEvent,
} from '@chordflow/chart-schema';
import type { generationJobEvents, generationJobs } from '../db/jobs-schema';

export type JobRow = typeof generationJobs.$inferSelect;
export type JobEventRow = typeof generationJobEvents.$inferSelect;

const iso = (value: string): string => new Date(value).toISOString();

/** Failed jobs, and jobs cancelled before any draft existed, can be retried as a new job. */
export function canRetryJob(row: Pick<JobRow, 'state' | 'resultRevisionId'>): boolean {
  return (
    row.state === 'failed_terminal' || (row.state === 'cancelled' && row.resultRevisionId === null)
  );
}

/**
 * User-facing job view. A lease that has expired but not yet been swept is
 * reported as waiting/queued rather than "processing", so a dead worker
 * never looks busy.
 */
export function toJobView(
  row: JobRow,
  options: { isAdmin: boolean; workerAvailable: boolean; now?: Date },
): GenerationJobView {
  const state = JobStateSchema.parse(row.state);
  const now = options.now ?? new Date();
  const leaseExpired =
    (state === 'leased' || state === 'running') &&
    row.leaseExpiresAt !== null &&
    new Date(row.leaseExpiresAt) <= now;
  const status = leaseExpired
    ? toExternalJobStatus('queued', { workerAvailable: options.workerAvailable })
    : toExternalJobStatus(state, { workerAvailable: options.workerAvailable });
  const code = row.errorCode === null ? null : JobErrorCodeSchema.safeParse(row.errorCode);
  return {
    id: row.id,
    status,
    internalState: options.isAdmin ? state : null,
    title: row.title,
    inputKind: row.request.input.kind,
    options: row.request.options,
    progress: status === 'processing' ? row.progress : null,
    attempt: row.attempt,
    maxAttempts: row.maxAttempts,
    error:
      code?.success === true
        ? {
            code: code.data,
            message: row.errorMessage ?? '',
            retryable: row.errorRetryable ?? false,
          }
        : null,
    draft:
      row.resultArrangementId !== null && row.resultRevisionId !== null
        ? { arrangementId: row.resultArrangementId, revisionId: row.resultRevisionId }
        : null,
    retryOfJobId: row.retryOfJobId,
    canRetry: canRetryJob(row),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function toJobEvent(row: JobEventRow): JobEvent {
  return {
    from: row.fromState === null ? null : JobStateSchema.parse(row.fromState),
    to: JobStateSchema.parse(row.toState),
    attempt: row.attempt,
    actor: row.actor as JobEvent['actor'],
    code: row.code,
    at: iso(row.createdAt),
  };
}
