import { ok } from '@/lib/api/envelope';
import { apiRoute } from '@/lib/api/handler';
import { requireUser } from '@/server/auth/guards';
import { getLibrary } from '@/server/library/service';

export const dynamic = 'force-dynamic';

/** Favorites and recently opened charts that the user can still see. */
export const GET = apiRoute(async (request: Request, _context: unknown, requestId) => {
  const user = await requireUser(request);
  return ok(await getLibrary(user.db, user), requestId);
});
