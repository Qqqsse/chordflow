import { AudioUploadMetadataSchema } from '@chordflow/chart-schema';
import { ok } from '@/lib/api/envelope';
import { ApiProblem, apiRoute } from '@/lib/api/handler';
import { requireUser } from '@/server/auth/guards';
import { assertSameOrigin, rateLimit } from '@/server/security';
import { readUploadConfig } from '@/server/uploads/config';
import { createUpload, listUploads, requireUploadStore } from '@/server/uploads/service';

export const dynamic = 'force-dynamic';

/** Room for the multipart boundaries and the text fields around the file. */
const FORM_OVERHEAD_BYTES = 64 * 1024;

const field = (value: FormDataEntryValue | null) => (typeof value === 'string' ? value : undefined);

/** Own uploads (administrators: all uploads), with the upload policy and quota usage. */
export const GET = apiRoute(async (request: Request, _context: unknown, requestId) => {
  const user = await requireUser(request);
  return ok(await listUploads(user.db, user, readUploadConfig(process.env)), requestId);
});

/** Stores private audio with its rights declaration (multipart/form-data). */
export const POST = apiRoute(async (request: Request, _context: unknown, requestId) => {
  assertSameOrigin(request);
  const user = await requireUser(request);
  const config = readUploadConfig(process.env);
  rateLimit(request, `audio-uploads:${user.userId}`, 20, 60 * 60_000);
  // Refuse before reading the body: permissions first, then the declared size.
  await requireUploadStore(user.db, user, config);
  const declared = Number(request.headers.get('content-length') ?? Number.NaN);
  if (!Number.isFinite(declared)) {
    throw new ApiProblem(411, 'INVALID_REQUEST', 'Content-Length is required');
  }
  if (declared > config.maxBytes + FORM_OVERHEAD_BYTES) {
    throw new ApiProblem(413, 'PAYLOAD_TOO_LARGE', 'The audio file is too large', {
      maxBytes: config.maxBytes,
    });
  }
  const form = await request.formData().catch(() => {
    throw new ApiProblem(400, 'INVALID_REQUEST', 'Body must be multipart/form-data');
  });
  const file = form.get('file');
  const artist = field(form.get('artist'))?.trim() ?? '';
  const parsed = AudioUploadMetadataSchema.safeParse({
    title: field(form.get('title')),
    artist: artist === '' ? null : artist,
    declarationVersion: field(form.get('declarationVersion')),
    declarationAccepted: field(form.get('declarationAccepted')) === 'true',
  });
  if (!parsed.success || !(file instanceof File)) {
    throw new ApiProblem(
      422,
      'VALIDATION_FAILED',
      'An audio file, a title and the accepted rights declaration are required',
      {
        issues: parsed.success
          ? [{ path: ['file'], message: 'An audio file is required' }]
          : parsed.error.issues.map((i) => ({ path: i.path.map(String), message: i.message })),
      },
    );
  }
  const { title, declarationVersion } = parsed.data;
  const upload = await createUpload(user.db, user, config, {
    body: file.stream(),
    title,
    artist: parsed.data.artist,
    declarationVersion,
  });
  return ok({ upload }, requestId, 201);
});
