import { WorkerFailRequestSchema } from '@chordflow/chart-schema';
import { readJsonBody } from '@/lib/api/body';
import { ok } from '@/lib/api/envelope';
import { ApiProblem, apiRoute } from '@/lib/api/handler';
import { requireId } from '@/server/catalog/lookups';
import { requireWorker } from '@/server/jobs/worker-auth';
import { failJob } from '@/server/jobs/worker-service';

export const dynamic = 'force-dynamic';

/** Records a typed failure; retryable failures are requeued with backoff. */
export const POST = apiRoute(
  async (request: Request, { params }: { params: Promise<{ id: string }> }, requestId) => {
    const db = requireWorker(request);
    const id = requireId((await params).id, 'JOB_NOT_FOUND');
    const parsed = WorkerFailRequestSchema.safeParse(await readJsonBody(request, 8192));
    if (!parsed.success) {
      throw new ApiProblem(422, 'VALIDATION_FAILED', 'Invalid fail request', {
        issues: parsed.error.issues
          .slice(0, 50)
          .map((i) => ({ path: i.path.map(String), message: i.message })),
      });
    }
    return ok(await failJob(db, id, parsed.data), requestId);
  },
);
