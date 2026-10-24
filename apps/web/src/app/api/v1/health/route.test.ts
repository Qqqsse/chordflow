import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_VERSION } from '@chordflow/chart-schema';
import { GET } from './route';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /api/v1/health', () => {
  it('reports liveness in demo mode', async () => {
    vi.stubEnv('CHORDFLOW_DATA_MODE', '');
    const res = GET(
      new Request('http://localhost/api/v1/health', { headers: { 'x-request-id': 'req_t' } }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { status: 'ok', service: 'web', dataMode: 'demo' },
      meta: { requestId: 'req_t', schemaVersion: API_VERSION },
    });
  });

  it('does not leak the database URL', async () => {
    vi.stubEnv('CHORDFLOW_DATA_MODE', 'database');
    vi.stubEnv('DATABASE_URL', 'postgres://user:s3cret@db:5432/chordflow');
    const res = GET(new Request('http://localhost/api/v1/health'));
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain('s3cret');
    expect(text).not.toContain('postgres://');
  });

  it('returns a typed error for invalid configuration', async () => {
    vi.stubEnv('CHORDFLOW_DATA_MODE', 'database');
    vi.stubEnv('DATABASE_URL', '');
    const res = GET(new Request('http://localhost/api/v1/health'));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('CONFIGURATION_INVALID');
  });
});
