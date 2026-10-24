import { PublishRequestSchema } from '@chordflow/chart-schema';
import { readJsonBody } from '@/lib/api/body';
import { ok } from '@/lib/api/envelope';
import { ApiProblem, apiRoute } from '@/lib/api/handler';
import { requireAdmin } from '@/server/auth/guards';
import { publishRevision } from '@/server/catalog/editor';
import { toApiProblem } from '@/server/catalog/editor-errors';
import { requireId } from '@/server/catalog/lookups';
import { assertSameOrigin } from '@/server/security';

export const dynamic = 'force-dynamic';

/** Rights- and review-gated, transactional publish (admin only). Idempotent. */
export const POST = apiRoute(
  async (request: Request, { params }: { params: Promise<{ id: string }> }, requestId) => {
    assertSameOrigin(request);
    const { db, userId } = await requireAdmin(request);
    const arrangementId = requireId((await params).id, 'ARRANGEMENT_NOT_FOUND');
    const parsed = PublishRequestSchema.safeParse(await readJsonBody(request, 4096));
    if (!parsed.success) throw new ApiProblem(422, 'VALIDATION_FAILED', 'revisionId is required');
    const result = await publishRevision(db, arrangementId, parsed.data.revisionId, userId).catch(
      toApiProblem,
    );
    return ok(result, requestId);
  },
);
