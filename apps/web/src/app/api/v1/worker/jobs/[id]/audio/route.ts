import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { LeaseTokenSchema, WORKER_AUDIO_HEADERS, WorkerIdSchema } from '@chordflow/chart-schema';
import { REQUEST_ID_HEADER } from '@/lib/api/envelope';
import { ApiProblem, apiRoute } from '@/lib/api/handler';
import { requireId } from '@/server/catalog/lookups';
import { requireWorker } from '@/server/jobs/worker-auth';
import { leasedJobSource } from '@/server/jobs/worker-service';
import { readUploadConfig } from '@/server/uploads/config';
import { obtainUploadAudio } from '@/server/uploads/service';

export const dynamic = 'force-dynamic';

/** Streams the authorized audio of a job to the worker holding its lease. */
export const GET = apiRoute(
  async (request: Request, { params }: { params: Promise<{ id: string }> }, requestId) => {
    const db = requireWorker(request);
    const id = requireId((await params).id, 'JOB_NOT_FOUND');
    const workerId = WorkerIdSchema.safeParse(request.headers.get(WORKER_AUDIO_HEADERS.workerId));
    const leaseToken = LeaseTokenSchema.safeParse(
      request.headers.get(WORKER_AUDIO_HEADERS.leaseToken),
    );
    if (!workerId.success || !leaseToken.success) {
      throw new ApiProblem(422, 'VALIDATION_FAILED', 'Worker id and lease token headers are required');
    }
    const sourceId = await leasedJobSource(db, id, workerId.data, leaseToken.data);
    const config = readUploadConfig(process.env);
    const audio = await obtainUploadAudio(db, config, sourceId);
    const body = Readable.toWeb(createReadStream(audio.absolutePath)) as ReadableStream<Uint8Array>;
    return new Response(body, {
      status: 200,
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(audio.sizeBytes),
        'cache-control': 'no-store',
        [REQUEST_ID_HEADER]: requestId,
        [WORKER_AUDIO_HEADERS.sha256]: audio.sha256,
        [WORKER_AUDIO_HEADERS.format]: audio.format,
        [WORKER_AUDIO_HEADERS.maxDurationSeconds]: String(config.maxDurationSeconds),
      },
    });
  },
);
