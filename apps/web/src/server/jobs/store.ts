import { randomUUID } from 'node:crypto';
import { assertTransition, type JobState } from '@chordflow/chart-schema';
import { eq, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../db/client';
import { generationJobEvents, generationJobs, workerPresence } from '../db/jobs-schema';
import type { JobRow } from './views';

/* Low-level job persistence shared by the user-facing and worker services. */

export const newJobId = () => `job_${randomUUID().replaceAll('-', '')}`;

export type JobActor = 'user' | 'worker' | 'system' | 'admin';
type JobInsert = typeof generationJobs.$inferInsert;
/** Column updates; values may be SQL expressions such as `now() + …`. */
type JobUpdate = { [K in keyof JobInsert]?: JobInsert[K] | SQL };

/** Locks and returns the job row for the rest of the transaction. */
export async function lockJob(tx: Database, jobId: string): Promise<JobRow | null> {
  const [row] = await tx
    .select()
    .from(generationJobs)
    .where(eq(generationJobs.id, jobId))
    .for('update');
  return row ?? null;
}

export async function loadJob(db: Database, jobId: string): Promise<JobRow | null> {
  const [row] = await db.select().from(generationJobs).where(eq(generationJobs.id, jobId));
  return row ?? null;
}

/**
 * Moves a job along the state machine (checked here and by the database
 * trigger) and appends the transition to the event log.
 */
export async function transition(
  tx: Database,
  job: Pick<JobRow, 'id' | 'state' | 'attempt'>,
  to: JobState,
  actor: JobActor,
  options: { set?: JobUpdate; code?: string | null } = {},
): Promise<{ id: string; state: JobState; attempt: number }> {
  const from = job.state as JobState;
  assertTransition(from, to);
  const next = options.set?.attempt;
  const attempt = typeof next === 'number' ? next : job.attempt;
  await tx
    .update(generationJobs)
    .set({ ...options.set, state: to, updatedAt: sql`now()` })
    .where(eq(generationJobs.id, job.id));
  await tx.insert(generationJobEvents).values({
    jobId: job.id,
    fromState: from,
    toState: to,
    attempt,
    actor,
    code: options.code ?? null,
  });
  return { id: job.id, state: to, attempt };
}

export async function recordInitialEvent(tx: Database, jobId: string): Promise<void> {
  await tx
    .insert(generationJobEvents)
    .values({ jobId, fromState: null, toState: 'created', attempt: 0, actor: 'user', code: null });
}

/** Fields that release a lease; the token is kept so a retried report is recognised. */
export function releaseLease(token: string): JobUpdate {
  return {
    leaseOwner: null,
    leaseToken: null,
    leaseExpiresAt: null,
    leaseSeconds: null,
    releasedLeaseToken: token,
  };
}

/** Records worker contact; the version is reported at claim time only. */
export async function touchWorker(tx: Database, workerId: string, version?: string): Promise<void> {
  await tx
    .insert(workerPresence)
    .values({ workerId, workerVersion: version ?? 'unknown' })
    .onConflictDoUpdate({
      target: workerPresence.workerId,
      set:
        version === undefined
          ? { lastSeenAt: sql`now()` }
          : { workerVersion: version, lastSeenAt: sql`now()` },
    });
}

/** A worker counts as available when one has called the worker API within this window. */
export const WORKER_PRESENCE_WINDOW_SECONDS = 60;

export async function isWorkerAvailable(db: Database): Promise<boolean> {
  const [row] = await db
    .select({ id: workerPresence.workerId })
    .from(workerPresence)
    .where(
      sql`${workerPresence.lastSeenAt} > now() - (${WORKER_PRESENCE_WINDOW_SECONDS}::int * interval '1 second')`,
    )
    .limit(1);
  return row !== undefined;
}

/** Postgres unique violation, possibly wrapped by the query builder. */
export function isUniqueViolation(error: unknown): boolean {
  for (
    let e: unknown = error;
    e !== null && typeof e === 'object';
    e = (e as { cause?: unknown }).cause
  ) {
    if ((e as { code?: unknown }).code === '23505') return true;
  }
  return false;
}
