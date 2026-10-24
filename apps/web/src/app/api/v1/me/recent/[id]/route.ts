import { REQUEST_ID_HEADER } from '@/lib/api/envelope';
import { apiRoute } from '@/lib/api/handler';
import { requireUser } from '@/server/auth/guards';
import { requireId } from '@/server/catalog/lookups';
import { recordView } from '@/server/library/service';
import { assertSameOrigin } from '@/server/security';

export const dynamic = 'force-dynamic';

/** Records that the signed-in user opened this arrangement. */
export const POST = apiRoute(
  async (request: Request, { params }: { params: Promise<{ id: string }> }, requestId) => {
    assertSameOrigin(request);
    const user = await requireUser(request);
    const id = requireId((await params).id, 'ARRANGEMENT_NOT_FOUND');
    await recordView(user.db, user, id);
    return new Response(null, {
      status: 204,
      headers: { [REQUEST_ID_HEADER]: requestId, 'cache-control': 'no-store' },
    });
  },
);
