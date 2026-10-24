import { describe, expect, it } from 'vitest';
import { canonicalJson, sanitizeWorkerMessage, sha256Of } from './canonical';

describe('canonicalJson', () => {
  it('ignores key order at every depth', () => {
    expect(canonicalJson({ b: 1, a: { d: [{ y: 1, x: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[{"x":2,"y":1}]},"b":1}',
    );
    expect(sha256Of({ a: 1, b: 2 })).toBe(sha256Of({ b: 2, a: 1 }));
    expect(sha256Of({ a: 1 })).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('keeps array order significant', () => {
    expect(sha256Of([1, 2])).not.toBe(sha256Of([2, 1]));
  });
});

describe('sanitizeWorkerMessage', () => {
  it('removes URLs and absolute paths', () => {
    expect(
      sanitizeWorkerMessage('fetch https://example.org/a?token=s3cret failed at /srv/models/x.bin'),
    ).toBe('fetch [url] failed at [path]');
    expect(sanitizeWorkerMessage('C:\\models\\w.bin missing')).toBe('[path] missing');
    expect(sanitizeWorkerMessage('沒有可分析的授權音訊')).toBe('沒有可分析的授權音訊');
  });
});
