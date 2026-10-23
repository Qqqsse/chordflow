import { fail, ok, resolveRequestId } from '@/lib/api/envelope';
import { ConfigError, readRuntimeConfig } from '@/lib/config';

export const dynamic = 'force-dynamic';

/** Non-sensitive liveness probe (SPEC §10, §14). Never reports secrets or connection strings. */
export function GET(request: Request): Response {
  const requestId = resolveRequestId(request.headers);
  try {
    const config = readRuntimeConfig(process.env);
    return ok({ status: 'ok', service: 'web', dataMode: config.dataMode }, requestId);
  } catch (error) {
    if (error instanceof ConfigError) {
      return fail(500, 'CONFIGURATION_INVALID', 'Server configuration is invalid', requestId);
    }
    throw error;
  }
}
