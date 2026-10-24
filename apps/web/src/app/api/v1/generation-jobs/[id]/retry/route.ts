import { GenerationJobRetryRequestSchema } from '@chordflow/chart-schema';
import { readJsonBody } from '@/lib/api/body';
import { ok } from '@/lib/api/envelope';
import { ApiProblem, apiRoute } from '@/lib/api/handler';
import { requireUser } from '@/server/auth/guards';
import { requireId } from '@/server/catalog/lookups';
import { jobView } from '@/server/jobs/respond';
import { retryJob } from '@/server/jobs/service';
import { assertSameOrigin, rateLimit } from '@/server/security';

export const dynamic = 'force-dynamic';

/** Starts a new job with the request of a failed (or draft-less cancelled) job. */
export const POST = apiRoute(
  async (request: Request, { params }: { params: Promise<{ id: string }> }, requestId) => {
    assertSameOrigin(request);
    const user = await requireUser(request);
    rateLimit(request, `generation-jobs:${user.userId}`, 20, 60_000);
    const id = requireId((await params).id, 'JOB_NOT_FOUND');
    const parsed = GenerationJobRetryRequestSchema.safeParse(await readJsonBody(request, 1024));
    if (!parsed.success)
      throw new ApiProblem(422, 'VALIDATION_FAILED', 'idempotencyKey is required');
    const { row, reused } = await retryJob(user.db, user, id, parsed.data.idempotencyKey);
    return ok({ job: await jobView(user.db, row, user), reused }, requestId, reused ? 200 : 201);
  },
);
