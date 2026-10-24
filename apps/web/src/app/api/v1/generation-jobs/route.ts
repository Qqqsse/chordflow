import { GenerationJobCreateRequestSchema } from '@chordflow/chart-schema';
import { readJsonBody } from '@/lib/api/body';
import { ok } from '@/lib/api/envelope';
import { ApiProblem, apiRoute } from '@/lib/api/handler';
import { requireUser } from '@/server/auth/guards';
import { jobView, jobViews } from '@/server/jobs/respond';
import { listJobs, submitJob } from '@/server/jobs/service';
import { assertSameOrigin, rateLimit } from '@/server/security';

export const dynamic = 'force-dynamic';

/** Submits a generation job (members). 201 when created, 200 when an existing job is reused. */
export const POST = apiRoute(async (request: Request, _context: unknown, requestId) => {
  assertSameOrigin(request);
  const user = await requireUser(request);
  rateLimit(request, `generation-jobs:${user.userId}`, 20, 60_000);
  const parsed = GenerationJobCreateRequestSchema.safeParse(await readJsonBody(request, 64 * 1024));
  if (!parsed.success) {
    throw new ApiProblem(422, 'VALIDATION_FAILED', 'Invalid generation request', {
      issues: parsed.error.issues.map((i) => ({ path: i.path.map(String), message: i.message })),
    });
  }
  const { row, reused } = await submitJob(user.db, user, parsed.data);
  return ok({ job: await jobView(user.db, row, user), reused }, requestId, reused ? 200 : 201);
});

/** Own recent jobs, or every job for administrators. */
export const GET = apiRoute(async (request: Request, _context: unknown, requestId) => {
  const user = await requireUser(request);
  const rows = await listJobs(user.db, user);
  return ok({ items: await jobViews(user.db, rows, user) }, requestId);
});
