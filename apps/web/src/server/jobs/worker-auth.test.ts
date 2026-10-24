import { describe, expect, it } from 'vitest';
import { configuredWorkerTokens, matchesWorkerToken } from './worker-auth';

const CURRENT = 'current-worker-token-0123456789abcdef';
const PREVIOUS = 'previous-worker-token-0123456789abcdef';

describe('worker credential', () => {
  it('accepts the current and the previous token during rotation', () => {
    const tokens = configuredWorkerTokens({
      WORKER_TOKEN: CURRENT,
      WORKER_TOKEN_PREVIOUS: PREVIOUS,
    });
    expect(matchesWorkerToken(`Bearer ${CURRENT}`, tokens)).toBe(true);
    expect(matchesWorkerToken(`Bearer ${PREVIOUS}`, tokens)).toBe(true);
    expect(matchesWorkerToken(`Bearer ${CURRENT}x`, tokens)).toBe(false);
  });

  it('rejects missing, malformed and non-bearer credentials', () => {
    const tokens = configuredWorkerTokens({ WORKER_TOKEN: CURRENT });
    expect(matchesWorkerToken(null, tokens)).toBe(false);
    expect(matchesWorkerToken(CURRENT, tokens)).toBe(false);
    expect(matchesWorkerToken(`Basic ${CURRENT}`, tokens)).toBe(false);
    expect(matchesWorkerToken('Bearer ', tokens)).toBe(false);
  });

  it('ignores short and placeholder tokens (fails closed)', () => {
    expect(configuredWorkerTokens({ WORKER_TOKEN: 'short' })).toEqual([]);
    expect(
      configuredWorkerTokens({ WORKER_TOKEN: 'replace-with-a-generated-worker-token-000' }),
    ).toEqual([]);
    expect(matchesWorkerToken('Bearer short', [])).toBe(false);
  });
});
