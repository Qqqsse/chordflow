import { WorkerCompleteRequestSchema } from '@chordflow/chart-schema';
import { readJsonBody } from '@/lib/api/body';
import { ok } from '@/lib/api/envelope';
import { ApiProblem, apiRoute } from '@/lib/api/handler';
import { requireId } from '@/server/catalog/lookups';
import { requireWorker } from '@/server/jobs/worker-auth';
import { completeJob } from '@/server/jobs/worker-service';

export const dynamic = 'force-dynamic';

/** Stores the draft as a revision in review; repeating the same completion is safe. */
export const POST = apiRoute(
  async (request: Request, { params }: { params: Promise<{ id: string }> }, requestId) => {
    const db = requireWorker(request);
    const id = requireId((await params).id, 'JOB_NOT_FOUND');
    const parsed = WorkerCompleteRequestSchema.safeParse(
      await readJsonBody(request, 2 * 1024 * 1024),
    );
    if (!parsed.success) {
      throw new ApiProblem(422, 'VALIDATION_FAILED', 'Invalid complete request', {
        issues: parsed.error.issues
          .slice(0, 50)
          .map((i) => ({ path: i.path.map(String), message: i.message })),
      });
    }
    return ok(await completeJob(db, id, parsed.data), requestId);
  },
);
