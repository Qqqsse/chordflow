import { InvitationCreateRequestSchema } from '@chordflow/chart-schema';
import { ok } from '@/lib/api/envelope';
import { ApiProblem, apiRoute } from '@/lib/api/handler';
import { isAdmin } from '@/server/access';
import { getDatabase } from '@/server/catalog';
import { createInvitation, listInvitations } from '@/server/auth/invitations';
import { getPrincipal } from '@/server/auth/principal';
import { assertSameOrigin } from '@/server/security';

export const dynamic = 'force-dynamic';

async function requireAdmin(request: Request) {
  const db = getDatabase();
  if (db === null)
    throw new ApiProblem(404, 'NOT_FOUND', 'Accounts are not available in demo mode');
  const principal = await getPrincipal(request);
  if (principal.kind === 'anonymous')
    throw new ApiProblem(401, 'UNAUTHENTICATED', 'Sign in required');
  if (!isAdmin(principal)) throw new ApiProblem(403, 'FORBIDDEN', 'Administrators only');
  return { db: db.db, principal };
}

export const GET = apiRoute(async (request: Request, _context: unknown, requestId) => {
  const { db } = await requireAdmin(request);
  const rows = await listInvitations(db);
  return ok(
    rows.map((r) => ({
      id: r.id,
      role: r.role,
      note: r.note,
      expiresAt: r.expiresAt.toISOString(),
      usedAt: r.usedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
    requestId,
  );
});

/** Creates an invitation; the plaintext token is returned once and never stored. */
export const POST = apiRoute(async (request: Request, _context: unknown, requestId) => {
  assertSameOrigin(request);
  const { db, principal } = await requireAdmin(request);
  const body: unknown = await request.json().catch(() => null);
  const parsed = InvitationCreateRequestSchema.safeParse(body ?? {});
  if (!parsed.success) throw new ApiProblem(422, 'VALIDATION_FAILED', 'Invalid invitation request');
  const invite = await createInvitation(db, { createdBy: principal.userId, ...parsed.data });
  const base = new URL(process.env.APP_BASE_URL ?? 'http://localhost:3000');
  const acceptUrl = new URL(`/invite#token=${invite.token}`, base).toString();
  return ok(
    { id: invite.id, token: invite.token, acceptUrl, expiresAt: invite.expiresAt.toISOString() },
    requestId,
    201,
  );
});
