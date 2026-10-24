import { ok } from '@/lib/api/envelope';
import { ApiProblem, apiRoute } from '@/lib/api/handler';
import { getPrincipal } from '@/server/auth/principal';
import { getCatalog } from '@/server/catalog';
import { requireId, requireVisibleArrangement } from '@/server/catalog/lookups';
import { canViewRevision } from '@/server/access';

export const dynamic = 'force-dynamic';

/** Optional, recording-specific timing for one chart revision. */
export const GET = apiRoute(
  async (request: Request, { params }: { params: Promise<{ id: string }> }, requestId) => {
    const repo = getCatalog();
    const recordingId = requireId((await params).id, 'RECORDING_NOT_FOUND');
    const revisionId = new URL(request.url).searchParams.get('revisionId');
    if (revisionId === null) throw new ApiProblem(400, 'INVALID_QUERY', 'revisionId is required');
    const revision = await repo.getRevisionById(requireId(revisionId, 'CHART_NOT_FOUND'));
    const principal = await getPrincipal(request);
    if (revision === null) throw new ApiProblem(404, 'SYNC_NOT_FOUND', 'Sync was not found');
    const arrangement = await requireVisibleArrangement(
      repo,
      principal,
      revision.arrangementId,
    ).catch(() => null);
    const ownerUserId = arrangement ? await repo.getArrangementOwnerId(arrangement.id) : null;
    if (
      arrangement === null ||
      !canViewRevision(principal, { ...arrangement, ownerUserId }, revision)
    ) {
      throw new ApiProblem(404, 'SYNC_NOT_FOUND', 'Sync was not found');
    }
    const sync = await repo.getRecordingSync(recordingId, revision.id);
    if (sync === null) throw new ApiProblem(404, 'SYNC_NOT_FOUND', 'Sync was not found');
    return ok(sync, requestId);
  },
);
