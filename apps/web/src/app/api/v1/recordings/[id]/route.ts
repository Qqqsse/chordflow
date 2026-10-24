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
    const recording = await repo.getRecording(requireId((await params).id, 'RECORDING_NOT_FOUND'));
    if (recording === null)
      throw new ApiProblem(404, 'RECORDING_NOT_FOUND', 'Recording was not found');
    const work = await repo.getWork(recording.workId);
    if (work === null) throw new ApiProblem(404, 'RECORDING_NOT_FOUND', 'Recording was not found');
    const hit = await workHit(repo, await getPrincipal(request), work);
    const summary = hit.recordings.find((r) => r.id === recording.id);
    if (summary === undefined)
      throw new ApiProblem(404, 'RECORDING_NOT_FOUND', 'Recording was not found');
    const sources = (
      await Promise.all(recording.sourceReferenceIds.map((id) => repo.getSource(id)))
    )
      .filter((s) => s !== null)
      .map((s) => ({
        id: s.id,
        platform: s.platform,
        platformSourceId: s.platformSourceId,
        url: s.url,
        permission: s.permission,
        permittedUses: s.permittedUses,
      }));
    const mapped = new Set(summary.mappings.map((m) => m.arrangementId));
    return ok(
      {
        recording: summary,
        work: hit.work,
        durationMs: recording.durationMs,
        sources,
        arrangements: hit.arrangements.filter((a) => mapped.has(a.id)),
      },
      requestId,
    );
  },
);
