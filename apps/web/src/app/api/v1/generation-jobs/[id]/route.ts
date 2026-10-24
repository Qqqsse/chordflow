import { ok } from '@/lib/api/envelope';
import { apiRoute } from '@/lib/api/handler';
import { requireUser } from '@/server/auth/guards';
import { requireId } from '@/server/catalog/lookups';
import { jobView } from '@/server/jobs/respond';
import { getJob, listJobEvents } from '@/server/jobs/service';

export const dynamic = 'force-dynamic';

/** Status, limited progress, typed error and draft ids (owner or admin). */
export const GET = apiRoute(
  async (request: Request, { params }: { params: Promise<{ id: string }> }, requestId) => {
    const user = await requireUser(request);
    const id = requireId((await params).id, 'JOB_NOT_FOUND');
    const row = await getJob(user.db, id, user);
    const events = await listJobEvents(user.db, id, user);
    return ok({ job: await jobView(user.db, row, user), events }, requestId);
  },
);
