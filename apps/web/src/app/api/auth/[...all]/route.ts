import { fail, resolveRequestId } from '@/lib/api/envelope';
import { getAuth } from '@/server/auth';

export const dynamic = 'force-dynamic';

/** better-auth endpoints (sign-in, sign-out, session). Unavailable in demo mode. */
async function handle(request: Request): Promise<Response> {
  const auth = getAuth();
  if (auth === null) {
    return fail(
      404,
      'NOT_FOUND',
      'Accounts are not available in demo mode',
      resolveRequestId(request.headers),
    );
  }
  return auth.handler(request);
}

export const GET = handle;
export const POST = handle;
