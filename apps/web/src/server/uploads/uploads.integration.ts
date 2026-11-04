import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { GenerationJobCreateRequest } from '@chordflow/chart-schema';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import createFixture from '../../../../../fixtures/contracts/worker/job-create-request.json';
import { ApiProblem } from '@/lib/api/handler';
import { CURRENT_UPLOAD_DECLARATION, UPLOAD_DECLARATIONS } from '@/lib/rights-declaration';
import { createPgCatalog } from '../catalog/pg-repository';
import { authUsers } from '../db/auth-schema';
import type { Database, DatabaseHandle } from '../db/client';
import { generationJobEvents } from '../db/jobs-schema';
import { audioRightsDeclarations, audioUploads } from '../db/uploads-schema';
import { getJob, retryJob, submitJob } from '../jobs/service';
import { claimJob, leasedJobSource } from '../jobs/worker-service';
import type { UploadConfig } from './config';
import {
  canAnalyzeUpload,
  createUpload,
  getUploadPolicy,
  listUploads,
  obtainUploadAudio,
  setUploadBlock,
  sweepUploads,
  withdrawUpload,
  type UploadUser,
} from './service';

const DAY_MS = 86_400_000;

const expectProblem = async (work: Promise<unknown>, code: string) => {
  await expect(work).rejects.toSatisfy((e: unknown) => e instanceof ApiProblem && e.code === code);
};

const expectDbError = async (work: Promise<unknown>, code: string) => {
  await expect(work).rejects.toSatisfy((error: unknown) =>
    String((error as { cause?: unknown }).cause ?? error).includes(code),
  );
};

/** Synthetic WAV-shaped bytes (header + filler); `seed` makes the content unique. */
function wavBytes(size: number, seed: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size);
  const ascii = new TextEncoder();
  bytes.set(ascii.encode('RIFF'), 0);
  new DataView(bytes.buffer).setUint32(4, size - 8, true);
  bytes.set(ascii.encode('WAVE'), 8);
  bytes.fill(seed & 0xff, 12);
  return bytes;
}

const sha256 = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex');

const sourceJob = (key: string, sourceReferenceId: string): GenerationJobCreateRequest => ({
  ...(createFixture as GenerationJobCreateRequest),
  idempotencyKey: key,
  input: { kind: 'source_reference', sourceReferenceId },
});

/** Audio upload suite; registered by `../db.integration.test.ts` after the jobs suite. */
export function uploadsIntegrationSuite(getHandle: () => DatabaseHandle): void {
  describe('audio uploads', () => {
    let db: Database;
    let admin: UploadUser;
    const member: UploadUser = { userId: 'usr_upload_member', role: 'member' };
    const other: UploadUser = { userId: 'usr_upload_other', role: 'member' };
    let storeDir: string;
    let config: UploadConfig;

    const upload = (user: UploadUser, seed: number, size = 1024, settings = config) =>
      createUpload(db, user, settings, {
        body: new Blob([wavBytes(size, seed)]).stream(),
        title: '晨光小路（自錄）',
        artist: null,
        declarationVersion: CURRENT_UPLOAD_DECLARATION,
      });
    const rowOf = async (id: string) => {
      const [row] = await db.select().from(audioUploads).where(eq(audioUploads.id, id));
      if (row === undefined) throw new Error(`upload ${id} missing`);
      return row;
    };
    const exists = (relativePath: string) =>
      stat(path.join(storeDir, relativePath)).then(
        () => true,
        () => false,
      );
    const tmpFiles = () => readdir(path.join(storeDir, 'tmp')).catch(() => []);

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
        .values([
          { id: member.userId, name: '上傳會員', email: 'upload-member@example.org' },
          { id: other.userId, name: '另一位會員', email: 'upload-other@example.org' },
        ])
        .onConflictDoNothing();
      storeDir = await mkdtemp(path.join(tmpdir(), 'chordflow-uploads-'));
      config = {
        storageDir: storeDir,
        roles: new Set(['admin', 'member']),
        maxBytes: 4096,
        maxDurationSeconds: 900,
        quotaBytes: 10_000,
        retentionDays: 30,
      };
    });

    afterAll(async () => {
      await rm(storeDir, { recursive: true, force: true });
    });

    it('stores the file privately with a user_upload source and an append-only declaration', async () => {
      const view = await upload(admin, 1);
      expect(view).toMatchObject({
        status: 'active',
        format: 'wav',
        sizeBytes: 1024,
        sha256: sha256(wavBytes(1024, 1)),
        declarationVersion: 'audio-upload-v1',
        owner: { id: admin.userId },
        endedAt: null,
      });
      expect(view.expiresAt).not.toBeNull();
      const row = await rowOf(view.id);
      expect(row.storagePath).toBe(`uploads/${view.sourceReferenceId}/${view.sha256}.wav`);
      expect(await readFile(path.join(storeDir, row.storagePath))).toHaveLength(1024);
      expect(await tmpFiles()).toEqual([]);

      const source = await createPgCatalog(db).getSource(view.sourceReferenceId);
      expect(source).toMatchObject({
        platform: 'user_upload',
        platformSourceId: view.id,
        url: null,
        permission: 'analysis_permitted',
        permittedUses: ['audio_analysis'],
      });

      const [declaration] = await db
        .select()
        .from(audioRightsDeclarations)
        .where(eq(audioRightsDeclarations.sourceId, view.sourceReferenceId));
      expect(declaration).toMatchObject({ userId: admin.userId, version: 'audio-upload-v1' });
      expect(declaration?.textSha256).toBe(sha256(UPLOAD_DECLARATIONS['audio-upload-v1']));

      const byId = eq(audioRightsDeclarations.id, declaration?.id ?? 0);
      await expectDbError(
        db.update(audioRightsDeclarations).set({ version: 'audio-upload-v9' }).where(byId),
        'DECLARATION_APPEND_ONLY',
      );
      await expectDbError(
        db.delete(audioRightsDeclarations).where(byId),
        'DECLARATION_APPEND_ONLY',
      );
      await expectDbError(
        db
          .update(audioUploads)
          .set({ storagePath: 'uploads/elsewhere.wav' })
          .where(eq(audioUploads.id, view.id)),
        'AUDIO_UPLOAD_IMMUTABLE',
      );
    });

    it('enforces roles, blocks and storage configuration before reading the file', async () => {
      const adminOnly = { ...config, roles: new Set(['admin'] as const) };
      await expectProblem(upload(member, 2, 1024, adminOnly), 'FORBIDDEN');
      expect((await getUploadPolicy(db, member, adminOnly)).reason).toBe('role_not_allowed');
      await expectProblem(
        upload(admin, 2, 1024, { ...config, storageDir: null }),
        'SERVICE_UNAVAILABLE',
      );

      await setUploadBlock(db, admin, member.userId, true);
      await setUploadBlock(db, admin, member.userId, true);
      await expectProblem(upload(member, 2), 'FORBIDDEN');
      expect(await getUploadPolicy(db, member, config)).toMatchObject({
        canUpload: false,
        reason: 'blocked',
      });
      const adminView = await listUploads(db, admin, config);
      expect(adminView.blockedUsers.map((b) => b.userId)).toContain(member.userId);
      expect((await listUploads(db, member, config)).blockedUsers).toEqual([]);
      await setUploadBlock(db, admin, member.userId, false);
      expect((await getUploadPolicy(db, member, config)).canUpload).toBe(true);

      await expectProblem(setUploadBlock(db, admin, admin.userId, true), 'VALIDATION_FAILED');
      await expectProblem(setUploadBlock(db, admin, 'usr_nobody_here', true), 'NOT_FOUND');
      expect(await tmpFiles()).toEqual([]);
    });

    it('rejects oversized, unknown and outdated uploads without leaving files behind', async () => {
      const before = await db.select({ id: audioUploads.id }).from(audioUploads);
      await expectProblem(upload(other, 3, 5000), 'PAYLOAD_TOO_LARGE');
      await expectProblem(
        createUpload(db, other, config, {
          body: new Blob(['<!doctype html><title>not audio</title>']).stream(),
          title: '不是音訊',
          artist: null,
          declarationVersion: CURRENT_UPLOAD_DECLARATION,
        }),
        'UNSUPPORTED_AUDIO_FORMAT',
      );
      await expectProblem(
        createUpload(db, other, config, {
          body: new Blob([wavBytes(512, 3)]).stream(),
          title: '舊聲明',
          artist: null,
          declarationVersion: 'audio-upload-v0',
        }),
        'VALIDATION_FAILED',
      );
      expect(await db.select({ id: audioUploads.id }).from(audioUploads)).toHaveLength(
        before.length,
      );
      expect(await tmpFiles()).toEqual([]);
    });

    it('limits each account to its storage quota', async () => {
      await upload(other, 4, 4000);
      await upload(other, 5, 4000);
      await expectProblem(upload(other, 6, 4000), 'QUOTA_EXCEEDED');
      const listed = await listUploads(db, other, config);
      expect(listed.policy.usedBytes).toBe(8000);
      expect(listed.items.every((item) => item.owner.id === other.userId)).toBe(true);
      // Administrators see every upload, with its uploader.
      const all = await listUploads(db, admin, config);
      expect(new Set(all.items.map((item) => item.owner.id))).toEqual(
        new Set([admin.userId, other.userId]),
      );
    });

    it('lets only the uploader or an administrator analyse an upload', async () => {
      const mine = await upload(member, 7);
      const { row } = await submitJob(
        db,
        member,
        sourceJob('upload-job-own', mine.sourceReferenceId),
      );
      expect(row.state).toBe('queued');
      await expectProblem(
        submitJob(db, other, sourceJob('upload-job-other', mine.sourceReferenceId)),
        'SOURCE_NOT_AUTHORIZED',
      );
      expect(await canAnalyzeUpload(db, mine.sourceReferenceId, admin)).toBe(true);
      // While a job may still need the audio, no deletion date is set.
      const listed = await listUploads(db, member, config);
      expect(listed.items.find((item) => item.id === mine.id)?.expiresAt).toBeNull();
    });

    it('withdrawing deletes the audio, revokes the source and cancels jobs that need it', async () => {
      const [mine] = (await listUploads(db, member, config)).items;
      if (mine === undefined) throw new Error('member upload missing');
      const storagePath = (await rowOf(mine.id)).storagePath;
      await expectProblem(withdrawUpload(db, other, config, mine.id), 'UPLOAD_NOT_FOUND');

      const withdrawn = await withdrawUpload(db, member, config, mine.id);
      expect(withdrawn).toMatchObject({ status: 'withdrawn', expiresAt: null });
      expect(withdrawn.endedAt).not.toBeNull();
      expect(await exists(storagePath)).toBe(false);
      expect((await rowOf(mine.id)).fileDeletedAt).not.toBeNull();
      expect(await createPgCatalog(db).getSource(mine.sourceReferenceId)).toMatchObject({
        permission: 'denied',
        permittedUses: [],
      });

      const [job] = await db
        .select({ jobId: generationJobEvents.jobId })
        .from(generationJobEvents)
        .where(
          and(
            eq(generationJobEvents.code, 'SOURCE_NOT_AUTHORIZED'),
            eq(generationJobEvents.toState, 'cancelled'),
          ),
        );
      if (job === undefined) throw new Error('job was not cancelled');
      const cancelled = await getJob(db, job.jobId, member);
      expect(cancelled).toMatchObject({ state: 'cancelled', errorCode: 'SOURCE_NOT_AUTHORIZED' });

      // Idempotent, and the audio can no longer be analysed or retried.
      expect((await withdrawUpload(db, member, config, mine.id)).status).toBe('withdrawn');
      await expectProblem(
        submitJob(db, member, sourceJob('upload-job-after', mine.sourceReferenceId)),
        'SOURCE_NOT_AUTHORIZED',
      );
      await expectProblem(
        retryJob(db, member, job.jobId, 'upload-job-retry'),
        'SOURCE_NOT_AUTHORIZED',
      );
      await expectDbError(
        db
          .update(audioUploads)
          .set({ status: 'active', endedAt: null })
          .where(eq(audioUploads.id, mine.id)),
        'AUDIO_UPLOAD_ENDED',
      );
    });

    it('expires unused uploads after retention but keeps those a job still needs', async () => {
      const unused = await upload(member, 8);
      const busy = await upload(member, 9);
      await submitJob(db, member, sourceJob('upload-job-busy', busy.sourceReferenceId));
      const unusedPath = (await rowOf(unused.id)).storagePath;

      const result = await sweepUploads(db, config, new Date(Date.now() + 31 * DAY_MS));
      expect(result.expired).toBeGreaterThanOrEqual(1);
      expect(await rowOf(unused.id)).toMatchObject({ status: 'expired' });
      expect((await rowOf(unused.id)).fileDeletedAt).not.toBeNull();
      expect(await exists(unusedPath)).toBe(false);
      expect(await createPgCatalog(db).getSource(unused.sourceReferenceId)).toMatchObject({
        permission: 'denied',
      });
      expect((await rowOf(busy.id)).status).toBe('active');

      // Clean up: withdrawing cancels the waiting job.
      await withdrawUpload(db, admin, config, busy.id);
      expect((await rowOf(busy.id)).status).toBe('withdrawn');
    });

    it('hands the audio only to the worker that holds the job lease', async () => {
      const mine = await upload(member, 11);
      const { row } = await submitJob(
        db,
        member,
        sourceJob('upload-job-audio', mine.sourceReferenceId),
      );
      const worker = 'gpu-test-1';
      // Other suites may have left queued jobs; claim until this one is leased.
      let claimed = null;
      for (let i = 0; i < 20 && claimed?.id !== row.id; i += 1) {
        claimed = await claimJob(db, {
          workerId: worker,
          workerVersion: '0.1.0',
          processors: ['mock'],
          leaseSeconds: 60,
        });
        if (claimed === null) break;
      }
      if (claimed?.id !== row.id) throw new Error('the upload job was not claimed');
      const lease = claimed.leaseToken;

      const sourceId = await leasedJobSource(db, row.id, worker, lease);
      expect(sourceId).toBe(mine.sourceReferenceId);
      const audio = await obtainUploadAudio(db, config, sourceId);
      expect(audio).toMatchObject({ sizeBytes: 1024, sha256: mine.sha256, format: 'wav' });
      expect(sha256(await readFile(audio.absolutePath))).toBe(mine.sha256);

      await expectProblem(leasedJobSource(db, row.id, 'gpu-test-2', lease), 'LEASE_LOST');
      await expectProblem(
        leasedJobSource(db, row.id, worker, `lease_${'0'.repeat(32)}`),
        'LEASE_LOST',
      );
      // A file that no longer matches its record is reported, never served.
      await writeFile(audio.absolutePath, 'changed');
      await expectProblem(obtainUploadAudio(db, config, sourceId), 'AUDIO_NOT_AVAILABLE');
      // Withdrawing cancels the leased job, so the worker loses access.
      await withdrawUpload(db, member, config, mine.id);
      await expectProblem(leasedJobSource(db, row.id, worker, lease), 'LEASE_LOST');
      await expectProblem(obtainUploadAudio(db, config, sourceId), 'AUDIO_NOT_AVAILABLE');
    });

    it('cleans up after a deleted account, orphaned files and stale partial uploads', async () => {
      const leaving: UploadUser = { userId: 'usr_upload_leaving', role: 'member' };
      await db
        .insert(authUsers)
        .values({ id: leaving.userId, name: '要離開的會員', email: 'upload-leaving@example.org' });
      const theirs = await upload(leaving, 10);
      const storagePath = (await rowOf(theirs.id)).storagePath;
      await db.delete(authUsers).where(eq(authUsers.id, leaving.userId));
      expect(await db.select().from(audioUploads).where(eq(audioUploads.id, theirs.id))).toEqual(
        [],
      );
      const [declaration] = await db
        .select()
        .from(audioRightsDeclarations)
        .where(eq(audioRightsDeclarations.sourceId, theirs.sourceReferenceId));
      expect(declaration?.userId).toBeNull();

      await mkdir(path.join(storeDir, 'tmp'), { recursive: true });
      const part = path.join(storeDir, 'tmp', 'interrupted.part');
      await writeFile(part, 'partial');
      const old = new Date(Date.now() - 2 * 60 * 60_000);
      await utimes(part, old, old);

      // Twenty minutes later the orphan is past its grace period.
      const result = await sweepUploads(db, config, new Date(Date.now() + 20 * 60_000));
      expect(result.sourcesRevoked).toBeGreaterThanOrEqual(1);
      expect(result.orphansDeleted).toBeGreaterThanOrEqual(1);
      expect(result.partsDeleted).toBe(1);
      expect(await exists(storagePath)).toBe(false);
      expect(await createPgCatalog(db).getSource(theirs.sourceReferenceId)).toMatchObject({
        permission: 'denied',
      });
      expect(await tmpFiles()).toEqual([]);
    });
  });
}
