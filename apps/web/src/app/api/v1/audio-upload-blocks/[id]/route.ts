import { OpaqueIdSchema } from '@chordflow/chart-schema';
import { ok } from '@/lib/api/envelope';
import { ApiProblem, apiRoute } from '@/lib/api/handler';
import { requireAdmin } from '@/server/auth/guards';
import { assertSameOrigin } from '@/server/security';
import { setUploadBlock } from '@/server/uploads/service';

export const dynamic = 'force-dynamic';

interface Context {
  params: Promise<{ id: string }>;
}

const handle = (blocked: boolean) =>
  apiRoute(async (request: Request, { params }: Context, requestId) => {
    assertSameOrigin(request);
    const admin = await requireAdmin(request);
    const userId = (await params).id;
    if (!OpaqueIdSchema.safeParse(userId).success) {
      throw new ApiProblem(404, 'NOT_FOUND', 'Account was not found');
    }
    return ok(await setUploadBlock(admin.db, admin, userId, blocked), requestId);
  });

/** Disables audio uploads for an account (admin); existing uploads are unaffected. */
export const PUT = handle(true);
/** Allows audio uploads for the account again (admin). */
export const DELETE = handle(false);
