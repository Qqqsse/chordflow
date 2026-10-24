import { ok } from '@/lib/api/envelope';
import { apiRoute } from '@/lib/api/handler';
import { requireUser } from '@/server/auth/guards';
import { requireId } from '@/server/catalog/lookups';
import { jobView } from '@/server/jobs/respond';
import { cancelJob } from '@/server/jobs/service';
import { assertSameOrigin } from '@/server/security';

export const dynamic = 'force-dynamic';

/** Cancels a job that has not produced a draft yet (owner or admin). Idempotent. */
export const POST = apiRoute(
  async (request: Request, { params }: { params: Promise<{ id: string }> }, requestId) => {
    assertSameOrigin(request);
    const user = await requireUser(request);
    const id = requireId((await params).id, 'JOB_NOT_FOUND');
    const row = await cancelJob(user.db, id, user);
    return ok({ job: await jobView(user.db, row, user), events: [] }, requestId);
  },
);
