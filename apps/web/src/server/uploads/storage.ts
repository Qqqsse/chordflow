import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, rmdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { SNIFF_BYTES } from './sniff';

/*
 * Private file store for uploaded audio (AUDIO_UPLOAD_DIR). Files live at
 * `uploads/<source id>/<sha256>.<format>`; partial uploads are written to
 * `tmp/` first. Nothing here is ever served over HTTP.
 */

export class UploadTooLargeError extends Error {
  override name = 'UploadTooLargeError';
}

export interface StagedFile {
  tmpPath: string;
  sizeBytes: number;
  sha256: string;
  /** First bytes, for format detection. */
  head: Uint8Array;
}

/** Streams `body` into `tmp/`, hashing it and stopping as soon as it exceeds `maxBytes`. */
export async function stageUpload(
  storeDir: string,
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<StagedFile> {
  const tmpDir = path.join(storeDir, 'tmp');
  await mkdir(tmpDir, { recursive: true });
  const tmpPath = path.join(tmpDir, `${randomUUID()}.part`);
  const hash = createHash('sha256');
  const head: number[] = [];
  let size = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      size += chunk.length;
      if (size > maxBytes) {
        done(new UploadTooLargeError());
        return;
      }
      if (head.length < SNIFF_BYTES) head.push(...chunk.subarray(0, SNIFF_BYTES - head.length));
      hash.update(chunk);
      done(null, chunk);
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(body as NodeReadableStream<Uint8Array>),
      meter,
      createWriteStream(tmpPath, { flags: 'wx' }),
    );
  } catch (error) {
    await rm(tmpPath, { force: true });
    throw error;
  }
  return { tmpPath, sizeBytes: size, sha256: hash.digest('hex'), head: Uint8Array.from(head) };
}

/** Absolute path for a store-relative path; refuses anything that would leave the store. */
export function resolveInStore(storeDir: string, relativePath: string): string {
  const root = path.resolve(storeDir);
  const resolved = path.resolve(root, relativePath);
  if (!resolved.startsWith(root + path.sep)) {
    throw new Error('path escapes the upload store');
  }
  return resolved;
}

export async function moveIntoStore(storeDir: string, tmpPath: string, relativePath: string) {
  const target = resolveInStore(storeDir, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await rename(tmpPath, target);
}

/** Deletes a stored file (missing is fine) and its per-source directory once empty. */
export async function deleteStoredFile(storeDir: string, relativePath: string): Promise<void> {
  const target = resolveInStore(storeDir, relativePath);
  await rm(target, { force: true });
  await rmdir(path.dirname(target)).catch(() => undefined);
}

export interface StoredFile {
  /** Store-relative, `/`-separated (the form kept in `audio_uploads.storage_path`). */
  path: string;
  modifiedAt: Date;
}

export async function listStoredFiles(storeDir: string): Promise<StoredFile[]> {
  const root = path.join(storeDir, 'uploads');
  const sources = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files: StoredFile[] = [];
  for (const source of sources) {
    if (!source.isDirectory()) continue;
    for (const name of await readdir(path.join(root, source.name)).catch(() => [])) {
      const info = await stat(path.join(root, source.name, name)).catch(() => null);
      if (info?.isFile() === true) {
        files.push({ path: `uploads/${source.name}/${name}`, modifiedAt: info.mtime });
      }
    }
  }
  return files;
}

/** Removes partial uploads left behind by interrupted requests; returns how many. */
export async function removeStaleParts(storeDir: string, olderThan: Date): Promise<number> {
  const tmpDir = path.join(storeDir, 'tmp');
  let removed = 0;
  for (const name of await readdir(tmpDir).catch(() => [])) {
    const file = path.join(tmpDir, name);
    const info = await stat(file).catch(() => null);
    if (info !== null && info.mtime < olderThan) {
      await rm(file, { force: true });
      removed += 1;
    }
  }
  return removed;
}
