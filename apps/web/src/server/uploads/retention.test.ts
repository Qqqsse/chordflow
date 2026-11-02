import { describe, expect, it } from 'vitest';
import { retentionDeadline } from './service';

const uploadedAt = new Date('2026-11-02T00:00:00.000Z');

describe('upload retention deadline', () => {
  it('counts from the upload when no job used it', () => {
    expect(retentionDeadline(uploadedAt, undefined, 30)?.toISOString()).toBe(
      '2026-12-02T00:00:00.000Z',
    );
  });

  it('counts from the last related job when it ended later', () => {
    const usage = { lastJobAt: new Date('2026-11-10T12:00:00.000Z'), busy: false };
    expect(retentionDeadline(uploadedAt, usage, 30)?.toISOString()).toBe(
      '2026-12-10T12:00:00.000Z',
    );
  });

  it('waits while a job may still need the audio', () => {
    expect(retentionDeadline(uploadedAt, { lastJobAt: uploadedAt, busy: true }, 30)).toBeNull();
  });
});
