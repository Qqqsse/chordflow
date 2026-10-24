import { readJsonBody } from '@/lib/api/body';
import { ok } from '@/lib/api/envelope';
import { ApiProblem, apiRoute } from '@/lib/api/handler';
import { requireAdmin } from '@/server/auth/guards';
import { NewArrangementSchema, createArrangement } from '@/server/catalog/editor';
import { toApiProblem } from '@/server/catalog/editor-errors';
import { assertSameOrigin } from '@/server/security';

export const dynamic = 'force-dynamic';

/** Creates an arrangement (and its work when new). Admin only. */
export const POST = apiRoute(async (request: Request, _context: unknown, requestId) => {
  assertSameOrigin(request);
  const { db, userId } = await requireAdmin(request);
  const parsed = NewArrangementSchema.safeParse(await readJsonBody(request, 32 * 1024));
  if (!parsed.success) throw new ApiProblem(422, 'VALIDATION_FAILED', 'Invalid arrangement');
  const created = await createArrangement(db, parsed.data, userId).catch(toApiProblem);
  return ok(created, requestId, 201);
});
