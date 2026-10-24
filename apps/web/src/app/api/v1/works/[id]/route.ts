import { ok } from '@/lib/api/envelope';
import { ApiProblem, apiRoute } from '@/lib/api/handler';
import { getPrincipal } from '@/server/auth/principal';
import { getCatalog } from '@/server/catalog';
import { requireId } from '@/server/catalog/lookups';
import { workHit } from '@/server/catalog/views';

export const dynamic = 'force-dynamic';

export const GET = apiRoute(
  async (request: Request, { params }: { params: Promise<{ id: string }> }, requestId) => {
    const repo = getCatalog();
    const work = await repo.getWork(requireId((await params).id, 'WORK_NOT_FOUND'));
    if (work === null) throw new ApiProblem(404, 'WORK_NOT_FOUND', 'Work was not found');
    return ok(await workHit(repo, await getPrincipal(request), work), requestId);
  },
);
