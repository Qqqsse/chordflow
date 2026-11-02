import type { AudioUpload, AudioUploadPolicy } from '@chordflow/chart-schema';

const UNITS = ['B', 'KB', 'MB', 'GB'] as const;

/** Binary sizes with the familiar short units, e.g. 52_428_800 → "50 MB". */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 || value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${String(rounded)} ${UNITS[unit] ?? 'B'}`;
}

export const formatDate = (iso: string) => new Date(iso).toLocaleDateString('zh-TW');

export const DENIAL_MESSAGES: Record<NonNullable<AudioUploadPolicy['reason']>, string> = {
  role_not_allowed: '目前沒有開放你的帳號上傳音訊。',
  blocked: '管理員已停用你的帳號上傳音訊的權限。',
  storage_not_configured: '伺服器尚未設定音訊的儲存位置，暫時不能上傳。',
};

export function uploadErrorMessage(code: string | undefined, maxBytes: number | null): string {
  switch (code) {
    case 'PAYLOAD_TOO_LARGE':
      return maxBytes === null ? '檔案太大。' : `檔案太大，單檔上限是 ${formatBytes(maxBytes)}。`;
    case 'UNSUPPORTED_AUDIO_FORMAT':
      return '不支援這個檔案格式，請上傳 WAV、FLAC、MP3、OGG 或 M4A。';
    case 'QUOTA_EXCEEDED':
      return '你的上傳空間不足，請先刪除不需要的音訊。';
    case 'FORBIDDEN':
      return '你的帳號目前不能上傳音訊。';
    case 'RATE_LIMITED':
      return '上傳太頻繁，請稍後再試。';
    case 'VALIDATION_FAILED':
      return '請選擇音訊檔、填寫歌名並勾選聲明；如果聲明內容剛更新，請重新整理頁面再試。';
    case 'SERVICE_UNAVAILABLE':
      return DENIAL_MESSAGES.storage_not_configured;
    default:
      return '上傳失敗，請稍後再試。';
  }
}

export function uploadStatusLabel(upload: Pick<AudioUpload, 'status' | 'expiresAt'>): string {
  if (upload.status === 'withdrawn') return '已刪除';
  if (upload.status === 'expired') return '已過保存期限，已刪除';
  if (upload.expiresAt === null) return '保存中（有任務使用中）';
  return `保存到 ${formatDate(upload.expiresAt)}`;
}
