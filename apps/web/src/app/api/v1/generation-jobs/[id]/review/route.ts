import { GenerationJobReviewRequestSchema } from '@chordflow/chart-schema';
import { readJsonBody } from '@/lib/api/body';
import { ok } from '@/lib/api/envelope';
import { ApiProblem, apiRoute } from '@/lib/api/handler';
import { requireAdmin } from '@/server/auth/guards';
import { requireId } from '@/server/catalog/lookups';
import { jobView } from '@/server/jobs/respond';
import { reviewJob } from '@/server/jobs/service';
import { assertSameOrigin } from '@/server/security';

export const dynamic = 'force-dynamic';

/** Publishes the draft (or a revision derived from it) or rejects it. Admin only. */
export const POST = apiRoute(
  async (request: Request, { params }: { params: Promise<{ id: string }> }, requestId) => {
    assertSameOrigin(request);
    const admin = await requireAdmin(request);
    const id = requireId((await params).id, 'JOB_NOT_FOUND');
    const parsed = GenerationJobReviewRequestSchema.safeParse(await readJsonBody(request, 4096));
    if (!parsed.success) throw new ApiProblem(422, 'VALIDATION_FAILED', 'Invalid review action');
    const { row, publishedRevisionId } = await reviewJob(admin.db, id, admin, parsed.data);
    return ok({ job: await jobView(admin.db, row, admin), publishedRevisionId }, requestId);
  },
);
