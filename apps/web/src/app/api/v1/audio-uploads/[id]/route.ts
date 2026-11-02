import { ok } from '@/lib/api/envelope';
import { apiRoute } from '@/lib/api/handler';
import { requireUser } from '@/server/auth/guards';
import { requireId } from '@/server/catalog/lookups';
import { assertSameOrigin } from '@/server/security';
import { readUploadConfig } from '@/server/uploads/config';
import { withdrawUpload } from '@/server/uploads/service';

export const dynamic = 'force-dynamic';

interface Context {
  params: Promise<{ id: string }>;
}

/** Withdraws an upload (uploader or admin): deletes the audio and revokes analysis; idempotent. */
export const DELETE = apiRoute(async (request: Request, { params }: Context, requestId) => {
  assertSameOrigin(request);
  const user = await requireUser(request);
  const id = requireId((await params).id, 'UPLOAD_NOT_FOUND');
  const upload = await withdrawUpload(user.db, user, readUploadConfig(process.env), id);
  return ok({ upload }, requestId);
});
