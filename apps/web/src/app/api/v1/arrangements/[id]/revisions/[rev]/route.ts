import { ok } from '@/lib/api/envelope';
import { ApiProblem, apiRoute } from '@/lib/api/handler';
import { canViewRevision } from '@/server/access';
import { getPrincipal } from '@/server/auth/principal';
import { getCatalog } from '@/server/catalog';
import { requireVisibleArrangement } from '@/server/catalog/lookups';

export const dynamic = 'force-dynamic';

/** Canonical Chart Document of one revision. */
export const GET = apiRoute(
  async (
    request: Request,
    { params }: { params: Promise<{ id: string; rev: string }> },
    requestId,
  ) => {
    const { id, rev } = await params;
    const repo = getCatalog();
    const principal = await getPrincipal(request);
    const arrangement = await requireVisibleArrangement(repo, principal, id);
    const number = /^[1-9]\d{0,6}$/.test(rev) ? Number(rev) : null;
    const revision = number === null ? null : await repo.getRevision(arrangement.id, number);
    const ownerUserId = await repo.getArrangementOwnerId(arrangement.id);
    if (
      revision === null ||
      !canViewRevision(principal, { ...arrangement, ownerUserId }, revision)
    ) {
      throw new ApiProblem(404, 'CHART_NOT_FOUND', 'Chart was not found');
    }
    return ok(revision, requestId);
  },
);
