import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError } from '@/lib/config';
import { UPLOAD_DEFAULTS, readUploadConfig } from './config';

const absolute = path.resolve('chordflow-test-uploads');

describe('audio upload configuration', () => {
  it('keeps uploads disabled and admin-only by default', () => {
    const config = readUploadConfig({});
    expect(config.storageDir).toBeNull();
    expect([...config.roles]).toEqual(['admin']);
    expect(config).toMatchObject({
      maxBytes: 50 * 1024 * 1024,
      maxDurationSeconds: 900,
      quotaBytes: 1024 * 1024 * 1024,
      retentionDays: 30,
    });
    expect(UPLOAD_DEFAULTS.retentionDays).toBe(30);
  });

  it('opens uploads to members and overrides every limit from the environment', () => {
    const config = readUploadConfig({
      AUDIO_UPLOAD_DIR: absolute,
      AUDIO_UPLOAD_ROLES: ' admin , member ',
      AUDIO_UPLOAD_MAX_BYTES: '1000',
      AUDIO_MAX_DURATION_SECONDS: '60',
      AUDIO_USER_QUOTA_BYTES: '5000',
      AUDIO_RETENTION_DAYS: '7',
    });
    expect(config.storageDir).toBe(absolute);
    expect([...config.roles].sort()).toEqual(['admin', 'member']);
    expect(config).toMatchObject({
      maxBytes: 1000,
      maxDurationSeconds: 60,
      quotaBytes: 5000,
      retentionDays: 7,
    });
  });

  it.each([
    ['a relative store directory', { AUDIO_UPLOAD_DIR: 'data/uploads' }],
    ['an unknown role', { AUDIO_UPLOAD_ROLES: 'admin,guest' }],
    ['a zero limit', { AUDIO_UPLOAD_MAX_BYTES: '0' }],
    ['a fractional limit', { AUDIO_RETENTION_DAYS: '1.5' }],
    ['a non-numeric limit', { AUDIO_USER_QUOTA_BYTES: '1GB' }],
  ])('rejects %s', (_label, env) => {
    expect(() => readUploadConfig(env)).toThrow(ConfigError);
  });
});
