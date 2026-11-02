import { readRuntimeConfig } from '@/lib/config';
import { openDatabase, type DatabaseHandle } from '../db/client';
import { readUploadConfig } from './config';
import { sweepUploads } from './service';

/*
 * Upload retention runs inside the web process: the service is started only
 * when it is used, so an external scheduler could miss deadlines. The first
 * sweep catches up shortly after start-up, then it repeats while running.
 * (Loaded from instrumentation.ts, so nothing here may import `server-only`.)
 */

const FIRST_SWEEP_DELAY_MS = 10_000;
const SWEEP_INTERVAL_MS = 6 * 60 * 60_000;

let started = false;
let handle: DatabaseHandle | undefined;

function log(level: 'info' | 'error', event: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ level, event, ...fields });
  if (level === 'error') console.error(line);
  else console.log(line);
}

async function runSweep(): Promise<void> {
  try {
    const config = readUploadConfig(process.env);
    handle ??= openDatabase(process.env.DATABASE_URL ?? '', { max: 2 });
    const result = await sweepUploads(handle.db, config);
    if (Object.values(result).some((count) => count > 0))
      log('info', 'audio_upload_sweep', { ...result });
  } catch (error) {
    log('error', 'audio_upload_sweep_failed', {
      error: error instanceof Error ? error.name : typeof error,
    });
  }
}

/** Starts the retention sweep in database mode; a no-op during builds and in demo mode. */
export function startUploadMaintenance(): void {
  if (started || process.env.NEXT_PHASE === 'phase-production-build') return;
  started = true;
  try {
    if (readRuntimeConfig(process.env).dataMode !== 'database') return;
  } catch {
    return; // Invalid configuration is reported by the routes themselves.
  }
  setTimeout(() => {
    void runSweep();
    setInterval(() => void runSweep(), SWEEP_INTERVAL_MS).unref();
  }, FIRST_SWEEP_DELAY_MS).unref();
}
