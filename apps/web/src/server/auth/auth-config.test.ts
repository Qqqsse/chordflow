import { describe, expect, it } from 'vitest';
import { DEFAULT_SIGN_IN_PER_MINUTE, parseSignInLimit, readAuthConfig } from './auth';

const env = {
  APP_BASE_URL: 'http://localhost:3000',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
};

describe('auth configuration', () => {
  it('keeps the strict sign-in limit by default', () => {
    expect(readAuthConfig(env).signInPerMinute).toBe(DEFAULT_SIGN_IN_PER_MINUTE);
    expect(DEFAULT_SIGN_IN_PER_MINUTE).toBe(10);
  });

  it('accepts an explicit limit and rejects nonsense', () => {
    expect(parseSignInLimit('100')).toBe(100);
    for (const bad of ['0', '-1', '1.5', 'abc', '5000']) {
      expect(() => parseSignInLimit(bad)).toThrow(/AUTH_SIGN_IN_PER_MINUTE/);
    }
  });
});
