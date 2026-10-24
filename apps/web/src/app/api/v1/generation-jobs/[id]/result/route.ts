import { ok } from '@/lib/api/envelope';
import { apiRoute } from '@/lib/api/handler';
import { requireUser } from '@/server/auth/guards';
import { requireId } from '@/server/catalog/lookups';
import { jobView } from '@/server/jobs/respond';
import { getJobResult, listJobEvents } from '@/server/jobs/service';

export const dynamic = 'force-dynamic';

/** Draft revision, quality report and artifact manifest (owner or admin). */
export const GET = apiRoute(
  async (request: Request, { params }: { params: Promise<{ id: string }> }, requestId) => {
    const user = await requireUser(request);
    const id = requireId((await params).id, 'JOB_NOT_FOUND');
    const result = await getJobResult(user.db, id, user);
    return ok(
      {
        job: await jobView(user.db, result.row, user),
        events: await listJobEvents(user.db, id, user),
        revision: result.revision,
        quality: result.quality,
        processor: result.processor,
        artifacts: result.artifacts,
      },
      requestId,
    );
  },
);
