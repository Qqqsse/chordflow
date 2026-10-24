import {
  JOB_STATES,
  type ArtifactManifestEntry,
  type GenerationJobCreateRequest,
  type JobProgress,
  type QualityReport,
} from '@chordflow/chart-schema';
import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { authUsers } from './auth-schema';
import { arrangements, chartRevisions } from './schema';

/*
 * Durable generation jobs (SPEC §10). The state column follows the table-driven
 * machine in @chordflow/chart-schema; every transition is appended to
 * generation_job_events. Leases are (owner, token, expiry) on the job row.
 */

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });
const inList = (column: string, values: readonly string[]) =>
  sql.raw(`${column} in (${values.map((v) => `'${v}'`).join(', ')})`);

/** States in which an equivalent request reuses the job instead of creating another. */
export const ACTIVE_JOB_STATES = [
  'created',
  'validated',
  'queued',
  'leased',
  'running',
  'failed_retryable',
  'draft_ready',
  'needs_review',
] as const;

export const generationJobs = pgTable(
  'generation_jobs',
  {
    id: text('id').primaryKey(),
    createdBy: text('created_by')
      .notNull()
      .references(() => authUsers.id),
    idempotencyKey: text('idempotency_key').notNull(),
    /** sha256 of the canonical request; equivalent active requests dedupe on it. */
    requestFingerprint: text('request_fingerprint').notNull(),
    request: jsonb('request').$type<GenerationJobCreateRequest>().notNull(),
    title: text('title').notNull(),
    state: text('state').notNull(),
    attempt: integer('attempt').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    leaseOwner: text('lease_owner'),
    leaseToken: text('lease_token'),
    leaseExpiresAt: ts('lease_expires_at'),
    /** Lease length requested at claim time; heartbeats extend by the same amount. */
    leaseSeconds: integer('lease_seconds'),
    /** Token of the last lease released by complete/fail, so a retried report is recognised. */
    releasedLeaseToken: text('released_lease_token'),
    /** Earliest time a requeued job may be claimed again (retry backoff). */
    notBefore: ts('not_before'),
    progress: jsonb('progress').$type<JobProgress>(),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    errorRetryable: boolean('error_retryable'),
    /** sha256 of the accepted completion payload, for idempotent replays. */
    completionDigest: text('completion_digest'),
    quality: jsonb('quality').$type<QualityReport>(),
    processorId: text('processor_id'),
    processorVersion: text('processor_version'),
    resultArrangementId: text('result_arrangement_id').references(() => arrangements.id),
    resultRevisionId: text('result_revision_id').references(() => chartRevisions.id),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('generation_jobs_idempotency').on(t.createdBy, t.idempotencyKey),
    uniqueIndex('generation_jobs_active_fingerprint')
      .on(t.createdBy, t.requestFingerprint)
      .where(inList('state', ACTIVE_JOB_STATES)),
    index('generation_jobs_claimable').on(t.state, t.notBefore, t.createdAt),
    index('generation_jobs_created_by').on(t.createdBy, t.createdAt),
    check('generation_jobs_state', inList('state', JOB_STATES)),
    check('generation_jobs_attempts', sql`${t.attempt} >= 0 and ${t.maxAttempts} >= 1`),
    check(
      'generation_jobs_lease',
      sql`(${t.leaseToken} is null) = (${t.leaseOwner} is null) and (${t.leaseToken} is null) = (${t.leaseExpiresAt} is null)`,
    ),
  ],
);

export const generationJobEvents = pgTable(
  'generation_job_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => generationJobs.id, { onDelete: 'cascade' }),
    fromState: text('from_state'),
    toState: text('to_state').notNull(),
    attempt: integer('attempt').notNull(),
    actor: text('actor').notNull(),
    code: text('code'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('generation_job_events_job').on(t.jobId, t.id),
    check('generation_job_events_actor', inList('actor', ['user', 'worker', 'system', 'admin'])),
  ],
);

export const generationArtifacts = pgTable(
  'generation_artifacts',
  {
    jobId: text('job_id')
      .notNull()
      .references(() => generationJobs.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    entry: jsonb('entry').$type<ArtifactManifestEntry>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.jobId, t.position] })],
);

/** Last contact per worker; drives the honest `waiting_for_worker` status. */
export const workerPresence = pgTable('worker_presence', {
  workerId: text('worker_id').primaryKey(),
  workerVersion: text('worker_version').notNull(),
  lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
});
