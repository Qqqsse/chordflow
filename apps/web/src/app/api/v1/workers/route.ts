import { ok } from '@/lib/api/envelope';
import { apiRoute } from '@/lib/api/handler';
import { requireAdmin } from '@/server/auth/guards';
import { WORKER_PRESENCE_WINDOW_SECONDS, listWorkers } from '@/server/jobs/store';

export const dynamic = 'force-dynamic';

/** Workers that have contacted the worker API, newest first, with online status. Admin only. */
export const GET = apiRoute(async (request: Request, _context: unknown, requestId) => {
  const admin = await requireAdmin(request);
  return ok(
    {
      workers: await listWorkers(admin.db),
      presenceWindowSeconds: WORKER_PRESENCE_WINDOW_SECONDS,
    },
    requestId,
  );
});
