import { ok } from '@/lib/api/envelope';
import { ApiProblem, apiRoute } from '@/lib/api/handler';
import { getPrincipal } from '@/server/auth/principal';
import { getCatalog } from '@/server/catalog';
import { searchCatalog } from '@/server/catalog/views';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(async (request: Request, _context: unknown, requestId) => {
  const params = new URL(request.url).searchParams;
  const limitParam = params.get('limit');
  const limit = limitParam === null ? 20 : Number(limitParam);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new ApiProblem(400, 'INVALID_QUERY', 'limit must be an integer 1–50');
  }
  const result = await searchCatalog(
    getCatalog(),
    await getPrincipal(request),
    params.get('q') ?? '',
    {
      limit,
      cursor: params.get('cursor'),
    },
  );
  if ('error' in result) throw new ApiProblem(400, result.error, result.message);
  return ok(result, requestId);
});
