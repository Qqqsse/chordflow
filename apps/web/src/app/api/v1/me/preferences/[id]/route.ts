import { ViewerPreferencesSchema } from '@chordflow/chart-schema';
import { readJsonBody } from '@/lib/api/body';
import { ok } from '@/lib/api/envelope';
import { ApiProblem, apiRoute } from '@/lib/api/handler';
import { requireUser } from '@/server/auth/guards';
import { requireId } from '@/server/catalog/lookups';
import { getPreferences, savePreferences } from '@/server/library/service';
import { assertSameOrigin } from '@/server/security';

export const dynamic = 'force-dynamic';

interface Context {
  params: Promise<{ id: string }>;
}

/** Saved viewer preferences for one arrangement, or `null`. */
export const GET = apiRoute(async (request: Request, { params }: Context, requestId) => {
  const user = await requireUser(request);
  const id = requireId((await params).id, 'ARRANGEMENT_NOT_FOUND');
  return ok(await getPreferences(user.db, user, id), requestId);
});

/** Saves the reader's own viewer settings; the chart itself is never changed. */
export const PUT = apiRoute(async (request: Request, { params }: Context, requestId) => {
  assertSameOrigin(request);
  const user = await requireUser(request);
  const id = requireId((await params).id, 'ARRANGEMENT_NOT_FOUND');
  const parsed = ViewerPreferencesSchema.safeParse(await readJsonBody(request, 8 * 1024));
  if (!parsed.success) throw new ApiProblem(422, 'VALIDATION_FAILED', 'Invalid viewer preferences');
  return ok(await savePreferences(user.db, user, id, parsed.data), requestId);
});
