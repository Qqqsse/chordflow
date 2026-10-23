import { describe, expect, it } from 'vitest';
import { API_SCHEMA_VERSION, fail, ok, resolveRequestId } from './envelope';

describe('resolveRequestId', () => {
  it('echoes a safe client request id', () => {
    expect(resolveRequestId(new Headers({ 'x-request-id': 'req_demo-1.a' }))).toBe('req_demo-1.a');
  });

  it.each(['', 'a'.repeat(65), 'bad id', '<script>', 'id\nnewline'])(
    'replaces unsafe request id %j',
    (value) => {
      const headers = new Headers();
      // Headers rejects raw newlines, so only set values it accepts.
      try {
        headers.set('x-request-id', value);
      } catch {
        // ignore: unset header is also an unsafe/missing case
      }
      const id = resolveRequestId(headers);
      expect(id).not.toBe(value);
      expect(id).toMatch(/^req_[0-9a-f-]{36}$/);
    },
  );

  it('generates an id when header is missing', () => {
    expect(resolveRequestId(new Headers())).toMatch(/^req_/);
  });
});

describe('envelope', () => {
  it('wraps success data with meta', async () => {
    const res = ok({ id: 'arr_demo_001' }, 'req_demo');
    expect(res.status).toBe(200);
    expect(res.headers.get('x-request-id')).toBe('req_demo');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({
      data: { id: 'arr_demo_001' },
      meta: { requestId: 'req_demo', schemaVersion: API_SCHEMA_VERSION },
    });
  });

  it('wraps errors with code, message, details and request id', async () => {
    const res = fail(404, 'CHART_NOT_FOUND', 'Chart was not found', 'req_demo');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: {
        code: 'CHART_NOT_FOUND',
        message: 'Chart was not found',
        details: null,
        requestId: 'req_demo',
      },
    });
  });
});
