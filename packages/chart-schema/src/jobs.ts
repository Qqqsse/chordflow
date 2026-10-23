import { z } from 'zod';

/*
 * Generation job state machine (SPEC §10). Internal states are explicit and
 * transitions are table-driven; user-facing status is derived, never stored.
 */

export const JOB_STATES = [
  'created',
  'validated',
  'queued',
  'leased',
  'running',
  'failed_retryable',
  'draft_ready',
  'needs_review',
  'published',
  'failed_terminal',
  'cancelled',
] as const;
export const JobStateSchema = z.enum(JOB_STATES);
export type JobState = z.infer<typeof JobStateSchema>;

const TRANSITIONS: Readonly<Record<JobState, readonly JobState[]>> = {
  created: ['validated', 'failed_terminal', 'cancelled'],
  validated: ['queued', 'failed_terminal', 'cancelled'],
  queued: ['leased', 'cancelled'],
  // `queued` from leased/running = lease expired and the job is requeued.
  leased: ['running', 'queued', 'failed_retryable', 'failed_terminal', 'cancelled'],
  running: ['draft_ready', 'queued', 'failed_retryable', 'failed_terminal', 'cancelled'],
  failed_retryable: ['queued', 'failed_terminal', 'cancelled'],
  draft_ready: ['needs_review'],
  // Rejecting the draft cancels publication; the draft revision itself is kept as `rejected`.
  needs_review: ['published', 'cancelled'],
  published: [],
  failed_terminal: [],
  cancelled: [],
};

export function allowedTransitions(from: JobState): readonly JobState[] {
  return TRANSITIONS[from];
}

export function canTransition(from: JobState, to: JobState): boolean {
  return TRANSITIONS[from].includes(to);
}

export class InvalidJobTransitionError extends Error {
  override name = 'InvalidJobTransitionError';
  constructor(
    readonly from: JobState,
    readonly to: JobState,
  ) {
    super(`job cannot move from "${from}" to "${to}"`);
  }
}

export function assertTransition(from: JobState, to: JobState): void {
  if (!canTransition(from, to)) {
    throw new InvalidJobTransitionError(from, to);
  }
}

export function isTerminalJobState(state: JobState): boolean {
  return TRANSITIONS[state].length === 0;
}

export const EXTERNAL_JOB_STATUSES = [
  'not_available',
  'queued',
  'waiting_for_worker',
  'processing',
  'needs_review',
  'completed',
  'failed',
  'cancelled',
] as const;
export const ExternalJobStatusSchema = z.enum(EXTERNAL_JOB_STATUSES);
export type ExternalJobStatus = z.infer<typeof ExternalJobStatusSchema>;

/**
 * User-facing status. `workerAvailable` reflects a recent worker heartbeat;
 * queued work with no live worker is reported honestly as waiting.
 * (`not_available` describes a source with no job possible, not a job state.)
 */
export function toExternalJobStatus(
  state: JobState,
  options: { workerAvailable: boolean },
): ExternalJobStatus {
  switch (state) {
    case 'created':
    case 'validated':
    case 'queued':
    case 'failed_retryable':
      return options.workerAvailable ? 'queued' : 'waiting_for_worker';
    case 'leased':
    case 'running':
      return 'processing';
    case 'draft_ready':
    case 'needs_review':
      return 'needs_review';
    case 'published':
      return 'completed';
    case 'failed_terminal':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
  }
}

export const JOB_ERROR_CODES = [
  'SOURCE_NOT_AUTHORIZED',
  'SOURCE_UNSUPPORTED',
  'AUDIO_NOT_AVAILABLE',
  'AUDIO_INVALID',
  'AUDIO_TOO_LONG',
  'ALIGNMENT_LOW_CONFIDENCE',
  'MODEL_UNAVAILABLE',
  'ARTIFACT_VALIDATION_FAILED',
  'LEASE_EXPIRED',
  'RETRY_LIMIT_EXCEEDED',
  'LLM_BUDGET_EXCEEDED',
  'INTERNAL_ERROR',
] as const;
export const JobErrorCodeSchema = z.enum(JOB_ERROR_CODES);
export type JobErrorCode = z.infer<typeof JobErrorCodeSchema>;
