import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import type { DatabaseHandle } from '../db/client';
import { authAccounts, invitations } from '../db/auth-schema';
import { createAuth, type Auth } from './auth';
import { AccountError, acceptInvitation, bootstrapAdmin, createInvitation } from './invitations';

const ADMIN = { email: 'Admin@Example.org', name: '管理員', password: 'admin-password-123' };

function sessionCookie(response: Response): string {
  const cookies = response.headers.getSetCookie();
  const session = cookies.find((c) => c.startsWith('chordflow.session_token='));
  if (session === undefined) throw new Error(`no session cookie in ${JSON.stringify(cookies)}`);
  return session.split(';')[0] ?? '';
}

async function signIn(auth: Auth, email: string, password: string): Promise<Response> {
  return auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
    headers: new Headers({ origin: 'http://localhost:3000' }),
  });
}

const expectAccountError = async (work: Promise<unknown>, code: AccountError['code']) => {
  await expect(work).rejects.toSatisfy(
    (e: unknown) => e instanceof AccountError && e.code === code,
  );
};

/** Accounts integration suite; registered by `../db.integration.test.ts`. */
export function authIntegrationSuite(getHandle: () => DatabaseHandle): void {
  describe('accounts', () => {
    let handle: DatabaseHandle;
    let auth: Auth;
    let adminId: string;

    beforeAll(async () => {
      handle = getHandle();
      auth = createAuth(handle.db, {
        baseURL: 'http://localhost:3000',
        secret: 'test-secret-'.padEnd(40, 'x'),
      });
      adminId = (await bootstrapAdmin(handle.db, auth, ADMIN)).userId;
    });

    it('bootstraps exactly one administrator with an Argon2id credential', async () => {
      await expectAccountError(
        bootstrapAdmin(handle.db, auth, { ...ADMIN, email: 'second@example.org' }),
        'ADMIN_EXISTS',
      );
      const [account] = await handle.db
        .select()
        .from(authAccounts)
        .where(eq(authAccounts.userId, adminId));
      expect(account?.providerId).toBe('credential');
      expect(account?.password?.startsWith('$argon2id$')).toBe(true);
    });

    it('signs in with email (case-insensitive) and resolves the role from the session', async () => {
      const response = await signIn(auth, 'admin@example.org', ADMIN.password);
      expect(response.status).toBe(200);
      const cookie = sessionCookie(response);
      expect(response.headers.getSetCookie().join(';').toLowerCase()).toContain('httponly');
      const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
      expect(session?.user.id).toBe(adminId);
      expect((session?.user as { role?: string } | undefined)?.role).toBe('admin');
    });

    it('rejects a wrong password', async () => {
      const response = await signIn(auth, 'admin@example.org', 'not-the-password');
      expect(response.status).toBe(401);
    });

    it('public sign-up is disabled', async () => {
      const response = await auth.handler(
        new Request('http://localhost:3000/api/auth/sign-up/email', {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
          body: JSON.stringify({
            email: 'x@example.org',
            name: 'x',
            password: 'long-enough-password',
          }),
        }),
      );
      expect(response.status).toBeGreaterThanOrEqual(400);
      const login = await signIn(auth, 'x@example.org', 'long-enough-password');
      expect(login.status).toBe(401);
    });

    it('an invitation creates a member once, then is spent', async () => {
      const invite = await createInvitation(handle.db, { createdBy: adminId, role: 'member' });
      const [stored] = await handle.db
        .select()
        .from(invitations)
        .where(eq(invitations.id, invite.id));
      expect(stored?.tokenHash).not.toContain(invite.token);
      const account = { email: 'friend@example.org', name: '朋友', password: 'friend-password-1' };
      const created = await acceptInvitation(handle.db, auth, { token: invite.token, account });
      expect(created.role).toBe('member');
      expect((await signIn(auth, account.email, account.password)).status).toBe(200);
      await expectAccountError(
        acceptInvitation(handle.db, auth, {
          token: invite.token,
          account: { ...account, email: 'other@example.org' },
        }),
        'INVITATION_INVALID',
      );
    });

    it('expired, unknown and malformed invitations are rejected', async () => {
      const old = await createInvitation(handle.db, {
        createdBy: adminId,
        role: 'member',
        now: new Date(Date.now() - 30 * 86_400_000),
      });
      const account = { email: 'late@example.org', name: '遲到', password: 'late-password-123' };
      await expectAccountError(
        acceptInvitation(handle.db, auth, { token: old.token, account }),
        'INVITATION_INVALID',
      );
      await expectAccountError(
        acceptInvitation(handle.db, auth, { token: 'nope', account }),
        'INVITATION_INVALID',
      );
      const fresh = await createInvitation(handle.db, { createdBy: adminId, role: 'member' });
      await expectAccountError(
        acceptInvitation(handle.db, auth, {
          token: fresh.token,
          account: { ...account, password: 'short' },
        }),
        'INVALID_INPUT',
      );
    });

    it('a duplicate email releases the invitation for another try', async () => {
      const invite = await createInvitation(handle.db, { createdBy: adminId, role: 'admin' });
      await expectAccountError(
        acceptInvitation(handle.db, auth, {
          token: invite.token,
          account: { email: 'FRIEND@example.org', name: '重複', password: 'another-password-1' },
        }),
        'EMAIL_TAKEN',
      );
      const ok = await acceptInvitation(handle.db, auth, {
        token: invite.token,
        account: {
          email: 'second-admin@example.org',
          name: '第二位管理員',
          password: 'another-password-1',
        },
      });
      expect(ok.role).toBe('admin');
    });
  });
}
