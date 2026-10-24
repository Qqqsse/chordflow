import { API_VERSION } from '@chordflow/chart-schema';

/**
 * Single response envelope shared by every `/api/v1` route (SPEC §10).
 * Success: `{ data, meta }`. Error: `{ error: { code, message, details, requestId } }`.
 */

/** Envelope `meta.schemaVersion`: the REST contract version from @chordflow/chart-schema. */
export const API_SCHEMA_VERSION = API_VERSION;

export const REQUEST_ID_HEADER = 'x-request-id';

export interface ApiMeta {
  requestId: string;
  schemaVersion: string;
}

export interface ApiSuccess<T> {
  data: T;
  meta: ApiMeta;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details: unknown;
    requestId: string;
  };
}

/** Client-provided request IDs are only echoed back when they are short and inert. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

export function resolveRequestId(headers: Headers): string {
  const incoming = headers.get(REQUEST_ID_HEADER);
  if (incoming !== null && SAFE_REQUEST_ID.test(incoming)) {
    return incoming;
  }
  return `req_${crypto.randomUUID()}`;
}

function jsonResponse(body: unknown, status: number, requestId: string): Response {
  return Response.json(body, {
    status,
    headers: {
      [REQUEST_ID_HEADER]: requestId,
      'cache-control': 'no-store',
    },
  });
}

export function ok(data: unknown, requestId: string, status = 200): Response {
  const body: ApiSuccess<unknown> = {
    data,
    meta: { requestId, schemaVersion: API_SCHEMA_VERSION },
  };
  return jsonResponse(body, status, requestId);
}

export function fail(
  status: number,
  code: string,
  message: string,
  requestId: string,
  details: unknown = null,
): Response {
  const body: ApiErrorBody = { error: { code, message, details, requestId } };
  return jsonResponse(body, status, requestId);
}
