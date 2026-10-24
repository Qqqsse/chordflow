import { WorkerClaimRequestSchema } from '@chordflow/chart-schema';
import { readJsonBody } from '@/lib/api/body';
import { ok } from '@/lib/api/envelope';
import { ApiProblem, apiRoute } from '@/lib/api/handler';
import { requireWorker } from '@/server/jobs/worker-auth';
import { claimJob } from '@/server/jobs/worker-service';

export const dynamic = 'force-dynamic';

/** Atomically leases the next eligible job; `{ job: null }` when the queue is empty. */
export const POST = apiRoute(async (request: Request, _context: unknown, requestId) => {
  const db = requireWorker(request);
  const parsed = WorkerClaimRequestSchema.safeParse(await readJsonBody(request, 4096));
  if (!parsed.success) throw new ApiProblem(422, 'VALIDATION_FAILED', 'Invalid claim request');
  return ok({ job: await claimJob(db, parsed.data) }, requestId);
});
