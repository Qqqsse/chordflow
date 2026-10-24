import { z } from 'zod';
import { ok } from '@/lib/api/envelope';
import { ApiProblem, apiRoute } from '@/lib/api/handler';
import { getAuth } from '@/server/auth';
import { AccountError, acceptInvitation } from '@/server/auth/invitations';
import { getDatabase } from '@/server/catalog';
import { assertSameOrigin, rateLimit } from '@/server/security';

export const dynamic = 'force-dynamic';

const BodySchema = z.strictObject({
  token: z.string().min(1).max(200),
  email: z.string(),
  name: z.string(),
  password: z.string(),
});

const STATUS: Record<
  AccountError['code'],
  [number, 'VALIDATION_FAILED' | 'FORBIDDEN' | 'REVISION_CONFLICT']
> = {
  INVALID_INPUT: [422, 'VALIDATION_FAILED'],
  INVITATION_INVALID: [403, 'FORBIDDEN'],
  EMAIL_TAKEN: [409, 'REVISION_CONFLICT'],
  ADMIN_EXISTS: [409, 'REVISION_CONFLICT'],
};

/** Accepts an invitation: creates the account and signs it in (session cookie). */
export const POST = apiRoute(async (request: Request, _context: unknown, requestId) => {
  assertSameOrigin(request);
  rateLimit(request, 'invitation-accept', 10, 15 * 60_000);
  const db = getDatabase();
  const auth = getAuth();
  if (db === null || auth === null)
    throw new ApiProblem(404, 'NOT_FOUND', 'Accounts are not available in demo mode');
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw new ApiProblem(422, 'VALIDATION_FAILED', 'Invalid request body');
  const { token, ...account } = parsed.data;
  try {
    const created = await acceptInvitation(db.db, auth, { token, account });
    const signIn = await auth.api.signInEmail({
      body: { email: account.email, password: account.password },
      asResponse: true,
      headers: request.headers,
    });
    const response = ok({ userId: created.userId, role: created.role }, requestId, 201);
    for (const cookie of signIn.headers.getSetCookie())
      response.headers.append('set-cookie', cookie);
    return response;
  } catch (error) {
    if (error instanceof AccountError) {
      const [status, code] = STATUS[error.code];
      throw new ApiProblem(status, code, error.message, { reason: error.code });
    }
    throw error;
  }
});
