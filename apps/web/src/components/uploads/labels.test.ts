import { describe, expect, it } from 'vitest';
import { formatBytes, uploadErrorMessage, uploadStatusLabel } from './labels';

describe('upload labels', () => {
  it.each([
    [0, '0 B'],
    [1023, '1023 B'],
    [1536, '1.5 KB'],
    [2.54 * 1024 * 1024, '2.5 MB'],
    [12.34 * 1024 * 1024, '12 MB'],
    [50 * 1024 * 1024, '50 MB'],
    [1024 * 1024 * 1024, '1 GB'],
  ])('formats %d bytes as %s', (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });

  it('explains failures in Traditional Chinese', () => {
    expect(uploadErrorMessage('PAYLOAD_TOO_LARGE', 50 * 1024 * 1024)).toBe(
      '檔案太大，單檔上限是 50 MB。',
    );
    expect(uploadErrorMessage('UNSUPPORTED_AUDIO_FORMAT', null)).toContain('WAV');
    expect(uploadErrorMessage(undefined, null)).toBe('上傳失敗，請稍後再試。');
  });

  it('describes what happens to the audio', () => {
    expect(uploadStatusLabel({ status: 'active', expiresAt: '2026-12-02T08:00:00.000Z' })).toBe(
      '保存到 2026/12/2',
    );
    expect(uploadStatusLabel({ status: 'active', expiresAt: null })).toBe('保存中（有任務使用中）');
    expect(uploadStatusLabel({ status: 'withdrawn', expiresAt: null })).toBe('已刪除');
    expect(uploadStatusLabel({ status: 'expired', expiresAt: null })).toBe('已過保存期限，已刪除');
  });
});
