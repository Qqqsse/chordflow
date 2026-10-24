import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, securityHeaders } from './security-headers';

const directives = (policy: string) =>
  new Map(policy.split('; ').map((d) => [d.split(' ')[0], d.split(' ').slice(1)]));

describe('Content-Security-Policy', () => {
  it('allows only this origin and forbids framing, plugins and foreign forms', () => {
    const csp = directives(contentSecurityPolicy({ development: false }));
    expect(csp.get('default-src')).toEqual(["'self'"]);
    expect(csp.get('connect-src')).toEqual(["'self'"]);
    expect(csp.get('frame-ancestors')).toEqual(["'none'"]);
    expect(csp.get('object-src')).toEqual(["'none'"]);
    expect(csp.get('form-action')).toEqual(["'self'"]);
    expect(csp.get('base-uri')).toEqual(["'self'"]);
    for (const values of csp.values()) {
      expect(values.some((v) => v.startsWith('http') || v === '*')).toBe(false);
    }
  });

  it('allows eval only for the development server', () => {
    expect(contentSecurityPolicy({ development: false })).not.toContain('unsafe-eval');
    expect(contentSecurityPolicy({ development: true })).toContain("'unsafe-eval'");
  });

  it('is sent with the other security headers', () => {
    const keys = securityHeaders({ development: false }).map((h) => h.key);
    expect(keys).toEqual([
      'Content-Security-Policy',
      'X-Content-Type-Options',
      'Referrer-Policy',
      'X-Frame-Options',
      'Permissions-Policy',
    ]);
  });
});
