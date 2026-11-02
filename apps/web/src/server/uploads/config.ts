import path from 'node:path';
import { ConfigError } from '@/lib/config';
import type { Role } from '../access';

/**
 * Audio upload settings (docs/audio-sources.md, owner decisions 2026-11-02).
 * Every limit is configurable; uploads stay disabled until AUDIO_UPLOAD_DIR
 * names a private directory that is never served.
 */
export interface UploadConfig {
  /** Absolute path of the private upload store, or `null` when uploads are not configured. */
  storageDir: string | null;
  roles: ReadonlySet<Role>;
  maxBytes: number;
  maxDurationSeconds: number;
  quotaBytes: number;
  retentionDays: number;
}

const MIB = 1024 * 1024;

export const UPLOAD_DEFAULTS = {
  roles: ['admin'] as readonly Role[],
  maxBytes: 50 * MIB,
  maxDurationSeconds: 15 * 60,
  quotaBytes: 1024 * MIB,
  retentionDays: 30,
};

function positiveInt(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: number,
) {
  const raw = env[name]?.trim() ?? '';
  if (raw === '') return fallback;
  const value = Number(raw);
  if (!/^[0-9]+$/.test(raw) || !Number.isSafeInteger(value) || value < 1) {
    throw new ConfigError(`${name} must be a positive integer`);
  }
  return value;
}

function parseRoles(raw: string | undefined): ReadonlySet<Role> {
  const names = (raw ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '');
  if (names.length === 0) return new Set(UPLOAD_DEFAULTS.roles);
  for (const name of names) {
    if (name !== 'admin' && name !== 'member') {
      throw new ConfigError(
        `AUDIO_UPLOAD_ROLES may only list admin and member, got ${JSON.stringify(name)}`,
      );
    }
  }
  return new Set(names as Role[]);
}

export function readUploadConfig(env: Readonly<Record<string, string | undefined>>): UploadConfig {
  const dir = env.AUDIO_UPLOAD_DIR?.trim() ?? '';
  if (dir !== '' && !path.isAbsolute(dir)) {
    throw new ConfigError('AUDIO_UPLOAD_DIR must be an absolute path');
  }
  return {
    storageDir: dir === '' ? null : dir,
    roles: parseRoles(env.AUDIO_UPLOAD_ROLES),
    maxBytes: positiveInt(env, 'AUDIO_UPLOAD_MAX_BYTES', UPLOAD_DEFAULTS.maxBytes),
    maxDurationSeconds: positiveInt(
      env,
      'AUDIO_MAX_DURATION_SECONDS',
      UPLOAD_DEFAULTS.maxDurationSeconds,
    ),
    quotaBytes: positiveInt(env, 'AUDIO_USER_QUOTA_BYTES', UPLOAD_DEFAULTS.quotaBytes),
    retentionDays: positiveInt(env, 'AUDIO_RETENTION_DAYS', UPLOAD_DEFAULTS.retentionDays),
  };
}
