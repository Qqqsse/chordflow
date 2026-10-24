import type { ApiErrorCode } from '@chordflow/chart-schema';
import { ConfigError } from '@/lib/config';
import { fail, resolveRequestId } from './envelope';

/** Error with a stable API code, thrown by route logic and mapped by `apiRoute`. */
export class ApiProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details: unknown = null,
  ) {
    super(message);
    this.name = 'ApiProblem';
  }
}

function isConnectionError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return (
    typeof code === 'string' &&
    ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'CONNECTION_CLOSED', '57P03'].includes(code)
  );
}

/** Structured log line without request bodies, query strings or error messages (may contain data). */
function logFailure(requestId: string, request: Request, error: unknown): void {
  const name = error instanceof Error ? error.name : typeof error;
  const code = (error as { code?: unknown } | null)?.code;
  console.error(
    JSON.stringify({
      level: 'error',
      requestId,
      method: request.method,
      path: new URL(request.url).pathname,
      error: name,
      code: typeof code === 'string' ? code : undefined,
    }),
  );
}

/**
 * Wraps a route handler with request ids and the shared error envelope.
 * Unexpected errors never leak messages or stack traces to the client.
 */
export function apiRoute<C>(
  handler: (request: Request, context: C, requestId: string) => Promise<Response>,
): (request: Request, context: C) => Promise<Response> {
  return async (request, context) => {
    const requestId = resolveRequestId(request.headers);
    try {
      return await handler(request, context, requestId);
    } catch (error) {
      if (error instanceof ApiProblem) {
        return fail(error.status, error.code, error.message, requestId, error.details);
      }
      logFailure(requestId, request, error);
      if (error instanceof ConfigError) {
        return fail(500, 'CONFIGURATION_INVALID', 'Server configuration is invalid', requestId);
      }
      if (isConnectionError(error)) {
        return fail(
          503,
          'SERVICE_UNAVAILABLE',
          'The catalog is temporarily unavailable',
          requestId,
        );
      }
      return fail(500, 'INTERNAL_ERROR', 'Unexpected server error', requestId);
    }
  };
}
