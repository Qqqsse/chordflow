import { sql } from 'drizzle-orm';
import { ok, resolveRequestId } from '@/lib/api/envelope';
import { apiRoute } from '@/lib/api/handler';
import { getDatabase } from '@/server/catalog';

export const dynamic = 'force-dynamic';

/** Readiness (SPEC §14): 503 when database mode cannot reach PostgreSQL. Liveness is /health. */
export const GET = apiRoute(async (request: Request) => {
  const requestId = resolveRequestId(request.headers);
  const handle = getDatabase();
  if (handle === null) {
    return ok({ status: 'ready', checks: { database: 'not_configured' } }, requestId);
  }
  try {
    await Promise.race([
      handle.db.execute(sql`select 1`),
      new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error('timeout'));
        }, 2_000);
      }),
    ]);
    return ok({ status: 'ready', checks: { database: 'ok' } }, requestId);
  } catch {
    return ok({ status: 'not_ready', checks: { database: 'unavailable' } }, requestId, 503);
  }
});
