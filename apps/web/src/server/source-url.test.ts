import { describe, expect, it } from 'vitest';
import { parseSourceUrl } from './source-url';

describe('parseSourceUrl', () => {
  it.each<[string, string, string]>([
    ['https://www.youtube.com/watch?v=DEMO0000001', 'youtube', 'DEMO0000001'],
    ['https://youtube.com/watch?v=DEMO0000001&t=42s', 'youtube', 'DEMO0000001'],
    ['https://music.youtube.com/watch?v=DEMO0000001&list=x', 'youtube', 'DEMO0000001'],
    ['https://youtu.be/DEMO0000001', 'youtube', 'DEMO0000001'],
    ['https://www.youtube.com/shorts/DEMO0000001', 'youtube', 'DEMO0000001'],
    ['www.youtube.com/watch?v=DEMO0000001', 'youtube', 'DEMO0000001'],
    ['https://open.spotify.com/track/0123456789abcdefABCDEF', 'spotify', '0123456789abcdefABCDEF'],
    [
      'https://open.spotify.com/intl-zh-tw/track/0123456789abcdefABCDEF',
      'spotify',
      '0123456789abcdefABCDEF',
    ],
  ])('%s → %s %s', (input, platform, id) => {
    expect(parseSourceUrl(input)).toEqual({ kind: 'source', platform, platformSourceId: id });
  });

  it.each<[string, string]>([
    ['http://www.youtube.com/watch?v=DEMO0000001', 'NOT_HTTPS'],
    ['https://evil.example/watch?v=DEMO0000001', 'HOST_NOT_ALLOWED'],
    ['https://www.youtube.com.evil.example/watch?v=DEMO0000001', 'HOST_NOT_ALLOWED'],
    ['https://127.0.0.1/watch?v=DEMO0000001', 'HOST_NOT_ALLOWED'],
    ['https://169.254.169.254/latest/meta-data', 'HOST_NOT_ALLOWED'],
    ['https://user:pw@www.youtube.com/watch?v=DEMO0000001', 'HOST_NOT_ALLOWED'],
    ['https://www.youtube.com:8443/watch?v=DEMO0000001', 'HOST_NOT_ALLOWED'],
    ['https://www.youtube.com/watch?v=short', 'NO_ID'],
    ['https://www.youtube.com/channel/abc', 'NO_ID'],
    ['https://open.spotify.com/album/0123456789abcdefABCDEF', 'NO_ID'],
    ['file:///etc/passwd', 'NOT_HTTPS'],
    ['https://[::1', 'INVALID_URL'],
  ])('%s → unsupported %s', (input, reason) => {
    expect(parseSourceUrl(input)).toEqual({ kind: 'unsupported', reason });
  });

  it('treats plain text as a normal search', () => {
    expect(parseSourceUrl('送別 李叔同')).toEqual({ kind: 'not_url' });
  });
});
