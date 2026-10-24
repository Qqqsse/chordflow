import { ok } from '@/lib/api/envelope';
import { ApiProblem, apiRoute } from '@/lib/api/handler';
import { requireAdmin } from '@/server/auth/guards';
import { listAudit } from '@/server/catalog/audit';
import { requireId } from '@/server/catalog/lookups';
import { createPgCatalog } from '@/server/catalog/pg-repository';

export const dynamic = 'force-dynamic';

/** Rights/visibility/publication history of one arrangement. Admin only. */
export const GET = apiRoute(
  async (request: Request, { params }: { params: Promise<{ id: string }> }, requestId) => {
    const { db } = await requireAdmin(request);
    const id = requireId((await params).id, 'ARRANGEMENT_NOT_FOUND');
    if ((await createPgCatalog(db).getArrangement(id)) === null) {
      throw new ApiProblem(404, 'ARRANGEMENT_NOT_FOUND', 'Arrangement was not found');
    }
    return ok({ arrangementId: id, events: await listAudit(db, id) }, requestId);
  },
);
