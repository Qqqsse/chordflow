import { createHash, randomUUID } from 'node:crypto';
import { rm, stat } from 'node:fs/promises';
import {
  AUDIO_FORMATS,
  type AudioFormat,
  type AudioUpload,
  type AudioUploadListData,
  type AudioUploadPolicy,
  type AudioUploadStatus,
  type UPLOAD_DENIAL_REASONS,
} from '@chordflow/chart-schema';
import { and, desc, eq, inArray, isNull, ne, sql, type SQL } from 'drizzle-orm';
import { ApiProblem } from '@/lib/api/handler';
import {
  CURRENT_UPLOAD_DECLARATION,
  UPLOAD_DECLARATIONS,
  type UploadDeclarationVersion,
} from '@/lib/rights-declaration';
import { authUsers } from '../db/auth-schema';
import type { Database } from '../db/client';
import { generationJobs } from '../db/jobs-schema';
import * as t from '../db/schema';
import { audioRightsDeclarations, audioUploadBlocks, audioUploads } from '../db/uploads-schema';
import { lockJob, releaseLease, transition, type JobActor } from '../jobs/store';
import type { UploadConfig } from './config';
import { sniffAudioFormat } from './sniff';
import {
  UploadTooLargeError,
  deleteStoredFile,
  listStoredFiles,
  moveIntoStore,
  removeStaleParts,
  resolveInStore,
  stageUpload,
} from './storage';

/*
 * User audio uploads (ADR-003): the `user_upload` SourceProvider. An upload
 * may be analysed only while it is active and only for its uploader or an
 * administrator; withdrawing or expiring it revokes the source, cancels jobs
 * that still need the audio and deletes the file.
 */

export interface UploadUser {
  userId: string;
  role: 'member' | 'admin';
}

type UploadRow = typeof audioUploads.$inferSelect;
type DenialReason = (typeof UPLOAD_DENIAL_REASONS)[number];

/** Job states in which a worker may still need the audio; retention waits for them. */
const JOBS_NEEDING_AUDIO = [
  'created',
  'validated',
  'queued',
  'leased',
  'running',
  'failed_retryable',
] as const;

const DAY_MS = 86_400_000;
/** Files younger than this are never treated as orphans (an upload may be committing). */
const ORPHAN_GRACE_MS = 10 * 60_000;
const STALE_PART_MS = 60 * 60_000;

const newId = (prefix: 'upl' | 'src') => `${prefix}_${randomUUID().replaceAll('-', '')}`;
const declarationSha256 = (version: UploadDeclarationVersion) =>
  createHash('sha256').update(UPLOAD_DECLARATIONS[version], 'utf8').digest('hex');
const jobSourceId = sql<
  string | null
>`${generationJobs.request} -> 'input' ->> 'sourceReferenceId'`;

interface JobUsage {
  lastJobAt: Date;
  busy: boolean;
}

/**
 * When an active upload is due for deletion: `retentionDays` after its upload or
 * after its last related job, whichever is later; `null` while a job still needs it.
 */
export function retentionDeadline(
  uploadedAt: Date,
  usage: JobUsage | undefined,
  retentionDays: number,
): Date | null {
  if (usage?.busy === true) return null;
  const from = usage !== undefined && usage.lastJobAt > uploadedAt ? usage.lastJobAt : uploadedAt;
  return new Date(from.getTime() + retentionDays * DAY_MS);
}

async function jobUsage(
  db: Database,
  sourceIds: readonly string[],
): Promise<Map<string, JobUsage>> {
  if (sourceIds.length === 0) return new Map();
  const rows = await db
    .select({
      sourceId: jobSourceId,
      lastJobAt: sql<number>`extract(epoch from max(${generationJobs.updatedAt}))::float8`,
      busy: sql<boolean>`bool_or(${inArray(generationJobs.state, [...JOBS_NEEDING_AUDIO])})`,
    })
    .from(generationJobs)
    .where(inArray(jobSourceId, [...sourceIds]))
    .groupBy(jobSourceId);
  const usage = new Map<string, JobUsage>();
  for (const row of rows) {
    if (row.sourceId !== null) {
      usage.set(row.sourceId, { lastJobAt: new Date(row.lastJobAt * 1000), busy: row.busy });
    }
  }
  return usage;
}

async function denialReason(
  db: Database,
  user: UploadUser,
  config: UploadConfig,
): Promise<DenialReason | null> {
  if (config.storageDir === null) return 'storage_not_configured';
  if (!config.roles.has(user.role)) return 'role_not_allowed';
  const [block] = await db
    .select({ userId: audioUploadBlocks.userId })
    .from(audioUploadBlocks)
    .where(eq(audioUploadBlocks.userId, user.userId));
  return block === undefined ? null : 'blocked';
}

async function usedBytes(db: Database, userId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${audioUploads.sizeBytes}), 0)` })
    .from(audioUploads)
    .where(and(eq(audioUploads.ownerUserId, userId), eq(audioUploads.status, 'active')));
  return Number(row?.total ?? 0);
}

export async function getUploadPolicy(
  db: Database,
  user: UploadUser,
  config: UploadConfig,
): Promise<AudioUploadPolicy> {
  const reason = await denialReason(db, user, config);
  return {
    canUpload: reason === null,
    reason,
    maxBytes: config.maxBytes,
    maxDurationSeconds: config.maxDurationSeconds,
    quotaBytes: config.quotaBytes,
    usedBytes: await usedBytes(db, user.userId),
    retentionDays: config.retentionDays,
    declarationVersion: CURRENT_UPLOAD_DECLARATION,
    formats: [...AUDIO_FORMATS],
  };
}

async function selectViews(
  db: Database,
  config: UploadConfig,
  where: SQL | undefined,
  limit: number,
): Promise<AudioUpload[]> {
  const rows = await db
    .select({
      upload: audioUploads,
      ownerName: authUsers.name,
      declarationVersion: audioRightsDeclarations.version,
    })
    .from(audioUploads)
    .innerJoin(authUsers, eq(authUsers.id, audioUploads.ownerUserId))
    .innerJoin(audioRightsDeclarations, eq(audioRightsDeclarations.id, audioUploads.declarationId))
    .where(where)
    .orderBy(desc(audioUploads.createdAt), desc(audioUploads.id))
    .limit(limit);
  const usage = await jobUsage(
    db,
    rows.filter((r) => r.upload.status === 'active').map((r) => r.upload.sourceId),
  );
  return rows.map(({ upload, ownerName, declarationVersion }) => {
    const expiresAt =
      upload.status === 'active'
        ? retentionDeadline(upload.createdAt, usage.get(upload.sourceId), config.retentionDays)
        : null;
    return {
      id: upload.id,
      sourceReferenceId: upload.sourceId,
      title: upload.title,
      artist: upload.artist,
      format: upload.format as AudioFormat,
      sizeBytes: upload.sizeBytes,
      sha256: upload.sha256,
      status: upload.status as AudioUploadStatus,
      declarationVersion,
      owner: { id: upload.ownerUserId, name: ownerName },
      uploadedAt: upload.createdAt.toISOString(),
      expiresAt: expiresAt?.toISOString() ?? null,
      endedAt: upload.endedAt?.toISOString() ?? null,
    };
  });
}

async function getUploadView(db: Database, config: UploadConfig, id: string) {
  const [view] = await selectViews(db, config, eq(audioUploads.id, id), 1);
  if (view === undefined) throw new ApiProblem(404, 'UPLOAD_NOT_FOUND', 'Upload was not found');
  return view;
}

export async function listUploads(
  db: Database,
  user: UploadUser,
  config: UploadConfig,
): Promise<AudioUploadListData> {
  const admin = user.role === 'admin';
  const items = await selectViews(
    db,
    config,
    admin ? undefined : eq(audioUploads.ownerUserId, user.userId),
    admin ? 200 : 100,
  );
  const blockedUsers = admin
    ? (
        await db
          .select({
            userId: audioUploadBlocks.userId,
            name: authUsers.name,
            at: audioUploadBlocks.createdAt,
          })
          .from(audioUploadBlocks)
          .innerJoin(authUsers, eq(authUsers.id, audioUploadBlocks.userId))
          .orderBy(desc(audioUploadBlocks.createdAt))
      ).map((b) => ({ userId: b.userId, name: b.name, blockedAt: b.at.toISOString() }))
    : [];
  return { policy: await getUploadPolicy(db, user, config), items, blockedUsers };
}

export interface UploadInput {
  body: ReadableStream<Uint8Array>;
  title: string;
  artist: string | null;
  declarationVersion: string;
}

/** The store directory, when this user may upload now; checked before any body is read. */
export async function requireUploadStore(
  db: Database,
  user: UploadUser,
  config: UploadConfig,
): Promise<string> {
  const reason = await denialReason(db, user, config);
  if (reason === 'storage_not_configured' || config.storageDir === null) {
    throw new ApiProblem(503, 'SERVICE_UNAVAILABLE', 'Audio uploads are not configured');
  }
  if (reason !== null) {
    throw new ApiProblem(403, 'FORBIDDEN', 'Audio uploads are not allowed for this account', {
      reason,
    });
  }
  return config.storageDir;
}

/** Stores a new upload: the file, its `user_upload` source and the declaration, atomically. */
export async function createUpload(
  db: Database,
  user: UploadUser,
  config: UploadConfig,
  input: UploadInput,
): Promise<AudioUpload> {
  const storeDir = await requireUploadStore(db, user, config);
  if (input.declarationVersion !== CURRENT_UPLOAD_DECLARATION) {
    throw new ApiProblem(
      422,
      'VALIDATION_FAILED',
      'The rights declaration has changed; read the current text and agree again',
      { declarationVersion: CURRENT_UPLOAD_DECLARATION },
    );
  }
  const staged = await stageUpload(storeDir, input.body, config.maxBytes).catch(
    (error: unknown) => {
      if (error instanceof UploadTooLargeError) {
        throw new ApiProblem(413, 'PAYLOAD_TOO_LARGE', 'The audio file is too large', {
          maxBytes: config.maxBytes,
        });
      }
      throw error;
    },
  );
  try {
    const format = sniffAudioFormat(staged.head);
    if (format === null) {
      throw new ApiProblem(415, 'UNSUPPORTED_AUDIO_FORMAT', 'Unsupported audio format', {
        formats: AUDIO_FORMATS,
      });
    }
    const uploadId = newId('upl');
    const sourceId = newId('src');
    const storagePath = `uploads/${sourceId}/${staged.sha256}.${format}`;
    await db.transaction(async (tx) => {
      // Serialises one user's uploads so the quota check is exact.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`audio-uploads:${user.userId}`}))`,
      );
      const used = await usedBytes(tx, user.userId);
      if (used + staged.sizeBytes > config.quotaBytes) {
        throw new ApiProblem(409, 'QUOTA_EXCEEDED', 'Not enough upload storage left', {
          usedBytes: used,
          quotaBytes: config.quotaBytes,
        });
      }
      await tx.insert(t.sourceReferences).values({
        id: sourceId,
        platform: 'user_upload',
        platformSourceId: uploadId,
        url: null,
        metadata: { title: input.title, artist: input.artist, durationMs: null },
        permission: 'analysis_permitted',
        permittedUses: ['audio_analysis'],
        acquiredAt: new Date().toISOString(),
      });
      const [declaration] = await tx
        .insert(audioRightsDeclarations)
        .values({
          userId: user.userId,
          sourceId,
          version: CURRENT_UPLOAD_DECLARATION,
          textSha256: declarationSha256(CURRENT_UPLOAD_DECLARATION),
        })
        .returning({ id: audioRightsDeclarations.id });
      if (declaration === undefined) throw new Error('declaration insert returned no row');
      await tx.insert(audioUploads).values({
        id: uploadId,
        sourceId,
        ownerUserId: user.userId,
        title: input.title,
        artist: input.artist,
        format,
        sizeBytes: staged.sizeBytes,
        sha256: staged.sha256,
        storagePath,
        declarationId: declaration.id,
      });
      // Last, so a rejected upload leaves no file; if the commit itself fails the
      // file is an orphan and the maintenance sweep deletes it.
      await moveIntoStore(storeDir, staged.tmpPath, storagePath);
    });
    return await getUploadView(db, config, uploadId);
  } finally {
    await rm(staged.tmpPath, { force: true });
  }
}

/** SourceProvider.canAnalyze for uploads: still active, and the caller uploaded it or is an admin. */
export async function canAnalyzeUpload(
  db: Database,
  sourceId: string,
  user: UploadUser,
): Promise<boolean> {
  const [row] = await db
    .select({ owner: audioUploads.ownerUserId })
    .from(audioUploads)
    .where(and(eq(audioUploads.sourceId, sourceId), eq(audioUploads.status, 'active')));
  return row !== undefined && (user.role === 'admin' || row.owner === user.userId);
}

export interface UploadAudio {
  absolutePath: string;
  sizeBytes: number;
  sha256: string;
  format: AudioFormat;
}

/**
 * SourceProvider.obtainAuthorizedAudio for uploads: the stored file of an active
 * upload. Callers must already have checked who may receive it (the job's lease).
 */
export async function obtainUploadAudio(
  db: Database,
  config: UploadConfig,
  sourceId: string,
): Promise<UploadAudio> {
  const notAvailable = () =>
    new ApiProblem(404, 'AUDIO_NOT_AVAILABLE', 'No authorized audio is available for this job');
  if (config.storageDir === null) throw notAvailable();
  const [row] = await db
    .select()
    .from(audioUploads)
    .where(and(eq(audioUploads.sourceId, sourceId), eq(audioUploads.status, 'active')));
  if (row === undefined) throw notAvailable();
  const absolutePath = resolveInStore(config.storageDir, row.storagePath);
  const info = await stat(absolutePath).catch(() => null);
  // A missing or changed file (e.g. a deleted volume) is reported, never served.
  if (info?.isFile() !== true || info.size !== row.sizeBytes) throw notAvailable();
  return {
    absolutePath,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    format: row.format as AudioFormat,
  };
}

/** Ends an upload: revokes its source and cancels jobs that still need the audio. */
async function endUpload(
  tx: Database,
  upload: UploadRow,
  status: Exclude<AudioUploadStatus, 'active'>,
  actor: JobActor,
): Promise<void> {
  await tx
    .update(audioUploads)
    .set({ status, endedAt: new Date() })
    .where(eq(audioUploads.id, upload.id));
  await tx
    .update(t.sourceReferences)
    .set({ permission: 'denied', permittedUses: [] })
    .where(eq(t.sourceReferences.id, upload.sourceId));
  const jobs = await tx
    .select({ id: generationJobs.id })
    .from(generationJobs)
    .where(
      and(eq(jobSourceId, upload.sourceId), inArray(generationJobs.state, [...JOBS_NEEDING_AUDIO])),
    );
  for (const { id } of jobs) {
    const job = await lockJob(tx, id);
    if (job === null || !(JOBS_NEEDING_AUDIO as readonly string[]).includes(job.state)) continue;
    await transition(tx, job, 'cancelled', actor, {
      set: {
        ...(job.leaseToken === null ? {} : releaseLease(job.leaseToken)),
        progress: null,
        errorCode: 'SOURCE_NOT_AUTHORIZED',
        errorMessage: '音訊已被刪除，任務已取消。',
        errorRetryable: false,
      },
      code: 'SOURCE_NOT_AUTHORIZED',
    });
  }
}

function logFileFailure(error: unknown): void {
  console.error(
    JSON.stringify({
      level: 'error',
      event: 'audio_file_delete_failed',
      error: error instanceof Error ? error.name : typeof error,
    }),
  );
}

/** Deletes an ended upload's file and records it; the sweep retries anything that fails. */
async function deleteEndedFile(
  db: Database,
  storeDir: string,
  upload: UploadRow,
): Promise<boolean> {
  try {
    await deleteStoredFile(storeDir, upload.storagePath);
  } catch (error) {
    logFileFailure(error);
    return false;
  }
  await db
    .update(audioUploads)
    .set({ fileDeletedAt: new Date() })
    .where(
      and(
        eq(audioUploads.id, upload.id),
        ne(audioUploads.status, 'active'),
        isNull(audioUploads.fileDeletedAt),
      ),
    );
  return true;
}

/** Withdraws an upload (its uploader or an administrator); repeating it changes nothing. */
export async function withdrawUpload(
  db: Database,
  user: UploadUser,
  config: UploadConfig,
  uploadId: string,
): Promise<AudioUpload> {
  const upload = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(audioUploads)
      .where(eq(audioUploads.id, uploadId))
      .for('update');
    // Someone else's upload looks the same as a missing one.
    if (row === undefined || (user.role !== 'admin' && row.ownerUserId !== user.userId)) {
      throw new ApiProblem(404, 'UPLOAD_NOT_FOUND', 'Upload was not found');
    }
    if (row.status === 'active') {
      await endUpload(tx, row, 'withdrawn', row.ownerUserId === user.userId ? 'user' : 'admin');
    }
    return row;
  });
  if (config.storageDir !== null && upload.fileDeletedAt === null) {
    await deleteEndedFile(db, config.storageDir, upload);
  }
  return getUploadView(db, config, uploadId);
}

/** Disables or re-enables uploads for an account (administrators; never their own). */
export async function setUploadBlock(
  db: Database,
  admin: UploadUser,
  userId: string,
  blocked: boolean,
): Promise<{ userId: string; blocked: boolean }> {
  if (userId === admin.userId) {
    throw new ApiProblem(422, 'VALIDATION_FAILED', 'You cannot change your own upload permission');
  }
  const [target] = await db
    .select({ id: authUsers.id })
    .from(authUsers)
    .where(eq(authUsers.id, userId));
  if (target === undefined) throw new ApiProblem(404, 'NOT_FOUND', 'Account was not found');
  if (blocked) {
    await db
      .insert(audioUploadBlocks)
      .values({ userId, blockedBy: admin.userId })
      .onConflictDoNothing();
  } else {
    await db.delete(audioUploadBlocks).where(eq(audioUploadBlocks.userId, userId));
  }
  return { userId, blocked };
}

export interface SweepResult {
  expired: number;
  sourcesRevoked: number;
  filesDeleted: number;
  orphansDeleted: number;
  partsDeleted: number;
}

/**
 * Retention and cleanup (idempotent): expires uploads past retention, revokes
 * sources left without an active upload (e.g. a deleted account), deletes the
 * files of ended uploads, orphaned files and stale partial uploads.
 */
export async function sweepUploads(
  db: Database,
  config: UploadConfig,
  now: Date = new Date(),
): Promise<SweepResult> {
  const result: SweepResult = {
    expired: 0,
    sourcesRevoked: 0,
    filesDeleted: 0,
    orphansDeleted: 0,
    partsDeleted: 0,
  };
  const active = await db.select().from(audioUploads).where(eq(audioUploads.status, 'active'));
  const usage = await jobUsage(
    db,
    active.map((u) => u.sourceId),
  );
  for (const candidate of active) {
    const due = retentionDeadline(
      candidate.createdAt,
      usage.get(candidate.sourceId),
      config.retentionDays,
    );
    if (due === null || due > now) continue;
    const expired = await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(audioUploads)
        .where(eq(audioUploads.id, candidate.id))
        .for('update');
      if (row?.status !== 'active') return false;
      // A job may have started since the first look.
      const current = (await jobUsage(tx, [row.sourceId])).get(row.sourceId);
      const deadline = retentionDeadline(row.createdAt, current, config.retentionDays);
      if (deadline === null || deadline > now) return false;
      await endUpload(tx, row, 'expired', 'system');
      return true;
    });
    if (expired) result.expired += 1;
  }

  const revoked = await db
    .update(t.sourceReferences)
    .set({ permission: 'denied', permittedUses: [] })
    .where(
      and(
        eq(t.sourceReferences.platform, 'user_upload'),
        ne(t.sourceReferences.permission, 'denied'),
        sql`not exists (select 1 from ${audioUploads} where ${audioUploads.sourceId} = ${t.sourceReferences.id} and ${audioUploads.status} = 'active')`,
      ),
    )
    .returning({ id: t.sourceReferences.id });
  result.sourcesRevoked = revoked.length;

  const storeDir = config.storageDir;
  if (storeDir === null) return result;
  const ended = await db
    .select()
    .from(audioUploads)
    .where(and(ne(audioUploads.status, 'active'), isNull(audioUploads.fileDeletedAt)));
  for (const upload of ended) {
    if (await deleteEndedFile(db, storeDir, upload)) result.filesDeleted += 1;
  }

  const owned = new Set(
    (
      await db
        .select({ path: audioUploads.storagePath })
        .from(audioUploads)
        .where(isNull(audioUploads.fileDeletedAt))
    ).map((r) => r.path),
  );
  const orphanCutoff = new Date(now.getTime() - ORPHAN_GRACE_MS);
  for (const file of await listStoredFiles(storeDir)) {
    if (owned.has(file.path) || file.modifiedAt > orphanCutoff) continue;
    await deleteStoredFile(storeDir, file.path);
    result.orphansDeleted += 1;
  }
  result.partsDeleted = await removeStaleParts(storeDir, new Date(now.getTime() - STALE_PART_MS));
  return result;
}
