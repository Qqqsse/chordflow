import { ok } from '@/lib/api/envelope';
import { apiRoute } from '@/lib/api/handler';
import { requireUser } from '@/server/auth/guards';
import { requireId } from '@/server/catalog/lookups';
import { setFavorite } from '@/server/library/service';
import { assertSameOrigin } from '@/server/security';

export const dynamic = 'force-dynamic';

interface Context {
  params: Promise<{ id: string }>;
}

const handle = (favorite: boolean) =>
  apiRoute(async (request: Request, { params }: Context, requestId) => {
    assertSameOrigin(request);
    const user = await requireUser(request);
    const id = requireId((await params).id, 'ARRANGEMENT_NOT_FOUND');
    return ok(await setFavorite(user.db, user, id, favorite), requestId);
  });

/** Adds a visible arrangement to favorites (idempotent). */
export const PUT = handle(true);
/** Removes it from favorites (idempotent). */
export const DELETE = handle(false);
