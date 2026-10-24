import type { GenerationJobCreateRequest, WorkerCompleteRequest } from '@chordflow/chart-schema';
import { WorkerCompleteRequestSchema } from '@chordflow/chart-schema';
import { eq, ne, sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import completeFixture from '../../../../../fixtures/contracts/worker/complete-request.json';
import createFixture from '../../../../../fixtures/contracts/worker/job-create-request.json';
import { ApiProblem } from '@/lib/api/handler';
import { createRevision } from '../catalog/editor';
import { authUsers } from '../db/auth-schema';
import type { Database, DatabaseHandle } from '../db/client';
import { generationArtifacts, generationJobEvents, generationJobs } from '../db/jobs-schema';
import * as t from '../db/schema';
import {
  MAX_ACTIVE_JOBS,
  cancelJob,
  getJob,
  getJobResult,
  listJobEvents,
  retryJob,
  reviewJob,
  submitJob,
  type JobUser,
} from './service';
import { isWorkerAvailable, listWorkers } from './store';
import { toJobView } from './views';
import { claimJob, completeJob, failJob, heartbeatJob } from './worker-service';

const expectProblem = async (work: Promise<unknown>, code: string) => {
  await expect(work).rejects.toSatisfy((e: unknown) => e instanceof ApiProblem && e.code === code);
};

const baseRequest = createFixture as GenerationJobCreateRequest;
const request = (
  key: string,
  overrides: Partial<GenerationJobCreateRequest> = {},
): GenerationJobCreateRequest => ({ ...baseRequest, idempotencyKey: key, ...overrides });
const withLyrics = (key: string, lyrics: string) =>
  request(key, {
    input: { kind: 'reference_lyrics', lyrics, language: 'zh-TW', concertKey: 'C', seed: 7 },
  });

const claimRequest = (workerId = 'cpu-mock-1', leaseSeconds = 60) => ({
  workerId,
  workerVersion: '0.1.0',
  processors: ['mock' as const],
  leaseSeconds,
});

function completion(jobId: string, workerId: string, leaseToken: string): WorkerCompleteRequest {
  const fixture = WorkerCompleteRequestSchema.parse(completeFixture);
  return {
    ...fixture,
    workerId,
    leaseToken,
    artifacts: fixture.artifacts.map((entry) => ({
      ...entry,
      storagePath: entry.storagePath.replace('jobs/job_fixture_001/', `jobs/${jobId}/`),
    })),
  };
}

async function eventTrail(db: Database, jobId: string): Promise<string[]> {
  const rows = await db
    .select()
    .from(generationJobEvents)
    .where(eq(generationJobEvents.jobId, jobId))
    .orderBy(generationJobEvents.id);
  return rows.map((r) => `${r.fromState ?? '∅'}>${r.toState}`);
}

/** Generation coordinator suite; registered by `../db.integration.test.ts` after the accounts suite. */
export function jobsIntegrationSuite(getHandle: () => DatabaseHandle): void {
  describe('generation jobs', () => {
    let db: Database;
    let admin: JobUser;
    let member: JobUser;

    beforeAll(async () => {
      db = getHandle().db;
      const [row] = await db
        .select({ id: authUsers.id })
        .from(authUsers)
        .where(eq(authUsers.role, 'admin'))
        .limit(1);
      if (!row) throw new Error('accounts suite must create an admin first');
      admin = { userId: row.id, role: 'admin' };
      await db
        .insert(authUsers)
        .values({ id: 'usr_jobs_member', name: '測試成員', email: 'jobs-member@example.org' })
        .onConflictDoNothing();
      member = { userId: 'usr_jobs_member', role: 'member' };
    });

    beforeEach(async () => {
      await db.execute(sql.raw('delete from generation_jobs; delete from worker_presence;'));
    });

    it('queues a submission through created → validated → queued', async () => {
      const { row, reused } = await submitJob(db, member, request('submit-0001'));
      expect(reused).toBe(false);
      expect(row.state).toBe('queued');
      expect(row.title).toBe('晨光小路（自創測試曲）');
      expect(await eventTrail(db, row.id)).toEqual([
        '∅>created',
        'created>validated',
        'validated>queued',
      ]);
      // No worker has ever reported: the status says so instead of "queued".
      const view = toJobView(row, { isAdmin: false, workerAvailable: await isWorkerAvailable(db) });
      expect(view.status).toBe('waiting_for_worker');
      expect(view.internalState).toBeNull();
    });

    it('is idempotent per key and deduplicates equivalent active requests', async () => {
      const first = await submitJob(db, member, request('idem-0001'));
      const again = await submitJob(db, member, request('idem-0001'));
      expect(again).toMatchObject({ reused: true, row: { id: first.row.id } });
      const equivalent = await submitJob(db, member, request('idem-0002'));
      expect(equivalent).toMatchObject({ reused: true, row: { id: first.row.id } });
      // CRLF vs LF and NFD vs NFC are not differences.
      const crlf = withLyrics(
        'idem-0003',
        baseRequest.input.kind === 'reference_lyrics'
          ? baseRequest.input.lyrics.replaceAll('\n', '\r\n').normalize('NFD')
          : '',
      );
      expect((await submitJob(db, member, crlf)).row.id).toBe(first.row.id);
      await expectProblem(
        submitJob(db, member, withLyrics('idem-0001', '另一首歌')),
        'IDEMPOTENCY_CONFLICT',
      );
      // Another user's identical request is a separate job.
      expect((await submitJob(db, admin, request('idem-0001'))).row.id).not.toBe(first.row.id);
    });

    it('creates exactly one job for simultaneous identical submissions', async () => {
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) => submitJob(db, member, request(`race-000${String(i)}`))),
      );
      expect(new Set(results.map((r) => r.row.id)).size).toBe(1);
      const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(generationJobs);
      expect(count?.n).toBe(1);
    });

    it('refuses unauthorised inputs before anything is queued', async () => {
      await expectProblem(
        submitJob(
          db,
          member,
          request('rights-0001', {
            target: {
              ...baseRequest.target,
              rights: { ...baseRequest.target.rights, lyrics: 'unknown' },
            },
          }),
        ),
        'SOURCE_NOT_AUTHORIZED',
      );
      const [discovery] = await db
        .select({ id: t.sourceReferences.id })
        .from(t.sourceReferences)
        .where(ne(t.sourceReferences.permission, 'analysis_permitted'))
        .limit(1);
      expect(discovery).toBeDefined();
      for (const sourceReferenceId of [discovery?.id ?? 'src_missing', 'src_does_not_exist']) {
        await expectProblem(
          submitJob(
            db,
            member,
            request(`source-${sourceReferenceId}`, {
              input: { kind: 'source_reference', sourceReferenceId },
            }),
          ),
          'SOURCE_NOT_AUTHORIZED',
        );
      }
      await expectProblem(
        submitJob(
          db,
          member,
          request('public-0001', {
            target: {
              ...baseRequest.target,
              visibility: 'public',
              rights: { ...baseRequest.target.rights, audio: 'unknown', lyrics: 'unknown' },
            },
          }),
        ),
        'VALIDATION_FAILED',
      );
      const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(generationJobs);
      expect(count?.n).toBe(0);
    });

    it('limits unfinished jobs per user', async () => {
      for (let i = 0; i < MAX_ACTIVE_JOBS.member; i += 1) {
        await submitJob(db, member, withLyrics(`quota-000${String(i)}`, `第 ${String(i)} 首`));
      }
      await expectProblem(
        submitJob(db, member, withLyrics('quota-0099', '再一首')),
        'QUOTA_EXCEEDED',
      );
    });

    it('runs claim → heartbeat → complete → review, and completion is idempotent', async () => {
      const { row } = await submitJob(db, admin, request('flow-0001'));
      const job = await claimJob(db, claimRequest());
      expect(job).toMatchObject({ id: row.id, attempt: 1, maxAttempts: 3, title: row.title });
      expect(job?.input).toEqual(row.request.input);
      if (!job) throw new Error('no job claimed');
      expect(await claimJob(db, claimRequest('cpu-mock-2'))).toBeNull();

      await heartbeatJob(db, job.id, {
        workerId: 'cpu-mock-1',
        leaseToken: job.leaseToken,
        progress: { stage: 'chord_recognition', fraction: 0.4 },
      });
      const running = await getJob(db, job.id, admin);
      expect(running.state).toBe('running');
      const view = toJobView(running, {
        isAdmin: true,
        workerAvailable: await isWorkerAvailable(db),
      });
      expect(view).toMatchObject({
        status: 'processing',
        internalState: 'running',
        progress: { stage: 'chord_recognition', fraction: 0.4 },
      });
      await expectProblem(
        heartbeatJob(db, job.id, {
          workerId: 'cpu-mock-2',
          leaseToken: job.leaseToken,
          progress: { stage: 'fusion', fraction: 0.5 },
        }),
        'LEASE_LOST',
      );

      const payload = completion(job.id, 'cpu-mock-1', job.leaseToken);
      const done = await completeJob(db, job.id, payload);
      expect(done.replayed).toBe(false);
      const replay = await completeJob(db, job.id, payload);
      expect(replay).toEqual({ ...done, replayed: true });
      await expectProblem(
        completeJob(db, job.id, { ...payload, processor: { id: 'mock', version: '9.9.9' } }),
        'LEASE_LOST',
      );
      const [revisions] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(t.chartRevisions)
        .where(eq(t.chartRevisions.arrangementId, done.arrangementId));
      expect(revisions?.n).toBe(1);

      const result = await getJobResult(db, job.id, admin);
      expect(result.row.state).toBe('needs_review');
      expect(result.revision).toMatchObject({
        id: done.revisionId,
        status: 'needs_review',
        origin: 'ai_draft',
        revision: 1,
      });
      expect(result.revision.document.importMetadata.format).toBe('ai_draft');
      expect(result.quality.overallConfidence).toBeNull();
      expect(result.artifacts.map((a) => a.kind)).toEqual([
        'source_metadata',
        'chord_timeline',
        'aligned_lyrics',
        'fusion_draft',
      ]);
      await expectProblem(getJobResult(db, job.id, member), 'JOB_NOT_FOUND');
      expect(await listJobEvents(db, job.id, member)).toEqual([]);
      expect((await listJobEvents(db, job.id, admin)).map((e) => e.to)).toEqual([
        'created',
        'validated',
        'queued',
        'leased',
        'running',
        'draft_ready',
        'needs_review',
      ]);

      // Review: an edited revision derived from the draft is published; the draft stays in history.
      const {
        chartRevisionId: _c,
        arrangementId: _a,
        revision: _r,
        schemaVersion: _s,
        ...content
      } = result.revision.document;
      const edited = await createRevision(db, {
        arrangementId: done.arrangementId,
        document: { ...content, title: `${content.title}（校訂）` },
        origin: 'human',
        parentRevisionId: done.revisionId,
        createdBy: admin.userId,
      });
      const unrelated = await db
        .select({ id: t.chartRevisions.id })
        .from(t.chartRevisions)
        .where(ne(t.chartRevisions.arrangementId, done.arrangementId))
        .limit(1);
      await expectProblem(
        reviewJob(db, job.id, admin, {
          action: 'publish',
          revisionId: unrelated[0]?.id ?? 'rev_x',
        }),
        'PUBLISH_REJECTED',
      );
      const published = await reviewJob(db, job.id, admin, {
        action: 'publish',
        revisionId: edited.id,
      });
      expect(published).toMatchObject({
        publishedRevisionId: edited.id,
        row: { state: 'published' },
      });
      const again = await reviewJob(db, job.id, admin, {
        action: 'publish',
        revisionId: edited.id,
      });
      expect(again.publishedRevisionId).toBe(edited.id);
      const [arrangement] = await db
        .select({ pointer: t.arrangements.publishedRevisionId, owner: t.arrangements.ownerUserId })
        .from(t.arrangements)
        .where(eq(t.arrangements.id, done.arrangementId));
      expect(arrangement).toEqual({ pointer: edited.id, owner: admin.userId });
      await expectProblem(reviewJob(db, job.id, admin, { action: 'reject' }), 'JOB_STATE_CONFLICT');
    });

    it('rejecting a draft cancels the job and keeps the revision as rejected', async () => {
      const { row } = await submitJob(db, member, request('reject-0001'));
      const job = await claimJob(db, claimRequest());
      if (job?.id !== row.id) throw new Error('claim mismatch');
      const done = await completeJob(db, job.id, completion(job.id, 'cpu-mock-1', job.leaseToken));
      await expectProblem(cancelJob(db, job.id, member), 'JOB_STATE_CONFLICT');
      const reviewed = await reviewJob(db, job.id, admin, { action: 'reject' });
      expect(reviewed).toMatchObject({ publishedRevisionId: null, row: { state: 'cancelled' } });
      const [revision] = await db
        .select({ status: t.chartRevisions.status })
        .from(t.chartRevisions)
        .where(eq(t.chartRevisions.id, done.revisionId));
      expect(revision?.status).toBe('rejected');
      // The member owns the draft arrangement and can read the result.
      expect((await getJobResult(db, job.id, member)).revision.status).toBe('rejected');
    });

    it('fails terminally on an invalid completion without storing a revision', async () => {
      await submitJob(db, member, request('invalid-0001'));
      const job = await claimJob(db, claimRequest());
      if (!job) throw new Error('no job claimed');
      const payload = completion(job.id, 'cpu-mock-1', job.leaseToken);
      const bad: WorkerCompleteRequest = {
        ...payload,
        draft: {
          ...payload.draft,
          quality: {
            ...payload.draft.quality,
            spans: [
              {
                target: { sectionId: 'sec_missing', lineId: null, chordId: null },
                reason: 'unaligned',
                message: 'x',
                source: 'processor',
              },
            ],
          },
        },
      };
      await expectProblem(completeJob(db, job.id, bad), 'ARTIFACT_VALIDATION_FAILED');
      const row = await getJob(db, job.id, member);
      expect(row).toMatchObject({
        state: 'failed_terminal',
        errorCode: 'ARTIFACT_VALIDATION_FAILED',
        resultRevisionId: null,
        leaseToken: null,
      });
      const [artifacts] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(generationArtifacts)
        .where(eq(generationArtifacts.jobId, job.id));
      expect(artifacts?.n).toBe(0);
    });

    it('requeues a job whose worker went offline and stops after max attempts', async () => {
      const { row } = await submitJob(db, member, request('offline-0001'));
      const expire = () =>
        db.execute(
          sql`update generation_jobs set lease_expires_at = now() - interval '1 second' where id = ${row.id}`,
        );
      const first = await claimJob(db, claimRequest('cpu-mock-1', 10));
      if (!first) throw new Error('no job claimed');
      await expire();
      const second = await claimJob(db, claimRequest('cpu-mock-2', 10));
      expect(second).toMatchObject({ id: row.id, attempt: 2 });
      expect(second?.leaseToken).not.toBe(first.leaseToken);
      // The stale worker can no longer report.
      await expectProblem(
        heartbeatJob(db, row.id, {
          workerId: 'cpu-mock-1',
          leaseToken: first.leaseToken,
          progress: { stage: 'fusion', fraction: 0.9 },
        }),
        'LEASE_LOST',
      );
      await expectProblem(
        completeJob(db, row.id, completion(row.id, 'cpu-mock-1', first.leaseToken)),
        'LEASE_LOST',
      );
      await expire();
      expect(await claimJob(db, claimRequest('cpu-mock-2', 10))).toMatchObject({ attempt: 3 });
      await expire();
      expect(await claimJob(db, claimRequest('cpu-mock-2', 10))).toBeNull();
      expect(await getJob(db, row.id, member)).toMatchObject({
        state: 'failed_terminal',
        errorCode: 'RETRY_LIMIT_EXCEEDED',
        attempt: 3,
      });
      expect(await eventTrail(db, row.id)).toContain('leased>queued');
    });

    it('retries retryable failures with backoff and records terminal ones', async () => {
      const { row } = await submitJob(db, member, request('retry-0001'));
      const first = await claimJob(db, claimRequest());
      if (!first) throw new Error('no job claimed');
      const failure = {
        workerId: 'cpu-mock-1',
        leaseToken: first.leaseToken,
        error: {
          code: 'MODEL_UNAVAILABLE' as const,
          message: 'model at /srv/models/x.bin not loaded (see https://example.org/?k=secret)',
          retryable: true,
        },
      };
      const retried = await failJob(db, row.id, failure);
      expect(retried.state).toBe('queued');
      expect(retried.nextAttemptAt).not.toBeNull();
      expect(await failJob(db, row.id, failure)).toMatchObject({ state: 'queued', replayed: true });
      const queued = await getJob(db, row.id, member);
      expect(queued.errorMessage).toBe('model at [path] not loaded (see [url]');
      // Backoff: not claimable until not_before passes.
      expect(await claimJob(db, claimRequest())).toBeNull();
      await db.execute(sql`update generation_jobs set not_before = null where id = ${row.id}`);
      const second = await claimJob(db, claimRequest());
      expect(second?.attempt).toBe(2);
      if (!second) throw new Error('no job claimed');
      const terminal = await failJob(db, row.id, {
        workerId: 'cpu-mock-1',
        leaseToken: second.leaseToken,
        error: { code: 'AUDIO_NOT_AVAILABLE', message: '沒有可分析的授權音訊', retryable: false },
      });
      expect(terminal).toEqual({ state: 'failed_terminal', nextAttemptAt: null, replayed: false });
      const view = toJobView(await getJob(db, row.id, member), {
        isAdmin: false,
        workerAvailable: true,
      });
      expect(view).toMatchObject({
        status: 'failed',
        error: { code: 'AUDIO_NOT_AVAILABLE', retryable: false },
      });
    });

    it('cancellation stops the worker at its next report', async () => {
      const { row } = await submitJob(db, member, request('cancel-0001'));
      const job = await claimJob(db, claimRequest());
      if (!job) throw new Error('no job claimed');
      const cancelled = await cancelJob(db, row.id, member);
      expect(cancelled).toMatchObject({ state: 'cancelled', leaseToken: null });
      expect((await cancelJob(db, row.id, member)).state).toBe('cancelled');
      await expect(
        heartbeatJob(db, row.id, {
          workerId: 'cpu-mock-1',
          leaseToken: job.leaseToken,
          progress: { stage: 'fusion', fraction: 0.5 },
        }),
      ).rejects.toThrow(/cancelled/);
      await expectProblem(
        cancelJob(db, row.id, { userId: 'usr_other', role: 'member' }),
        'JOB_NOT_FOUND',
      );
    });

    it('the database refuses transitions outside the state machine', async () => {
      const { row } = await submitJob(db, member, request('guard-0001'));
      await expect(
        db.execute(sql`update generation_jobs set state = 'published' where id = ${row.id}`),
      ).rejects.toThrow();
      await expect(
        db.execute(sql`update generation_jobs set request = '{}'::jsonb where id = ${row.id}`),
      ).rejects.toThrow();
      await expect(
        db.insert(generationJobs).values({
          ...row,
          id: 'job_guard_direct',
          idempotencyKey: 'guard-0002',
          requestFingerprint: 'x',
        }),
      ).rejects.toThrow();
    });

    it('retries a failed job as a new job and leaves the original untouched', async () => {
      const { row } = await submitJob(db, member, request('retry-orig-0001'));
      await expectProblem(retryJob(db, member, row.id, 'retry-new-0001'), 'JOB_STATE_CONFLICT');
      const job = await claimJob(db, claimRequest());
      if (!job) throw new Error('no job claimed');
      await failJob(db, row.id, {
        workerId: 'cpu-mock-1',
        leaseToken: job.leaseToken,
        error: { code: 'AUDIO_NOT_AVAILABLE', message: 'x', retryable: false },
      });
      const failed = await getJob(db, row.id, member);
      expect(toJobView(failed, { isAdmin: false, workerAvailable: true }).canRetry).toBe(true);
      // Another member cannot see (or retry) it.
      await expectProblem(
        retryJob(db, { userId: 'usr_other', role: 'member' }, row.id, 'retry-new-0002'),
        'JOB_NOT_FOUND',
      );
      // An admin may start it; the retry still belongs to the original submitter.
      const retry = await retryJob(db, admin, row.id, 'retry-new-0001');
      expect(retry.reused).toBe(false);
      expect(retry.row).toMatchObject({
        state: 'queued',
        retryOfJobId: row.id,
        createdBy: member.userId,
        attempt: 0,
      });
      expect((await retryJob(db, member, row.id, 'retry-new-0001')).row.id).toBe(retry.row.id);
      // A second retry while the first is still active reuses it (same request).
      expect((await retryJob(db, member, row.id, 'retry-new-0003')).row.id).toBe(retry.row.id);
      expect((await getJob(db, row.id, member)).state).toBe('failed_terminal');
    });

    it('allows retrying a job cancelled before a draft, not a rejected draft', async () => {
      const { row } = await submitJob(db, member, request('retry-cancel-0001'));
      await cancelJob(db, row.id, member);
      const retry = await retryJob(db, member, row.id, 'retry-cancel-0002');
      expect(retry.row.retryOfJobId).toBe(row.id);
      const claimed = await claimJob(db, claimRequest());
      if (claimed?.id !== retry.row.id) throw new Error('claim mismatch');
      await completeJob(db, claimed.id, completion(claimed.id, 'cpu-mock-1', claimed.leaseToken));
      await reviewJob(db, claimed.id, admin, { action: 'reject' });
      const rejected = await getJob(db, claimed.id, member);
      expect(toJobView(rejected, { isAdmin: false, workerAvailable: true }).canRetry).toBe(false);
      await expectProblem(
        retryJob(db, member, claimed.id, 'retry-cancel-0003'),
        'JOB_STATE_CONFLICT',
      );
    });

    it('lists workers with their online status', async () => {
      await claimJob(db, claimRequest('cpu-mock-7'));
      await db.execute(
        sql`insert into worker_presence (worker_id, worker_version, last_seen_at) values ('cpu-old', '0.0.1', now() - interval '10 minutes')`,
      );
      const workers = await listWorkers(db);
      expect(workers.find((w) => w.workerId === 'cpu-mock-7')).toMatchObject({
        online: true,
        workerVersion: '0.1.0',
      });
      expect(workers.find((w) => w.workerId === 'cpu-old')?.online).toBe(false);
    });
  });
}
