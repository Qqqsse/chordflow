import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Role } from '../access';
import type { Database } from '../db/client';
import { authUsers, invitations } from '../db/auth-schema';
import type { Auth } from './auth';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from './password';

/*
 * Invitation-only accounts (SPEC §12). The plaintext token is returned once
 * to the inviting admin; only its SHA-256 hash is stored. Claiming is a
 * single conditional UPDATE, so a token can never be used twice.
 */

export const INVITATION_TTL_DAYS = 7;

export class AccountError extends Error {
  constructor(
    readonly code: 'INVITATION_INVALID' | 'EMAIL_TAKEN' | 'INVALID_INPUT' | 'ADMIN_EXISTS',
    message: string,
  ) {
    super(message);
    this.name = 'AccountError';
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export async function createInvitation(
  db: Database,
  input: { createdBy: string; role: Role; note?: string | null; ttlDays?: number; now?: Date },
): Promise<{ id: string; token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + (input.ttlDays ?? INVITATION_TTL_DAYS) * 86_400_000);
  const id = `inv_${randomUUID()}`;
  await db.insert(invitations).values({
    id,
    tokenHash: hashToken(token),
    role: input.role,
    note: input.note ?? null,
    createdBy: input.createdBy,
    expiresAt,
  });
  return { id, token, expiresAt };
}

export const NewAccountSchema = z.strictObject({
  email: z.email().max(254),
  name: z.string().trim().min(1).max(80),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
});
export type NewAccount = z.infer<typeof NewAccountSchema>;

async function createCredentialUser(auth: Auth, account: NewAccount, role: Role) {
  const ctx = await auth.$context;
  if (await ctx.internalAdapter.findUserByEmail(account.email.toLowerCase())) {
    throw new AccountError('EMAIL_TAKEN', 'An account with this email already exists');
  }
  const user = await ctx.internalAdapter.createUser(
    { email: account.email.toLowerCase(), name: account.name, emailVerified: true, role },
    // Server-side provisioning by an invitation or the bootstrap CLI.
    { method: 'admin' },
  );
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: 'credential',
    accountId: user.id,
    password: await ctx.password.hash(account.password),
  });
  return user;
}

export async function acceptInvitation(
  db: Database,
  auth: Auth,
  input: { token: string; account: unknown; now?: Date },
): Promise<{ userId: string; role: Role }> {
  const parsed = NewAccountSchema.safeParse(input.account);
  if (!parsed.success)
    throw new AccountError('INVALID_INPUT', 'Name, email or password is invalid');
  const now = input.now ?? new Date();
  const [claimed] = await db
    .update(invitations)
    .set({ usedAt: now })
    .where(
      and(
        eq(invitations.tokenHash, hashToken(input.token)),
        isNull(invitations.usedAt),
        gt(invitations.expiresAt, now),
      ),
    )
    .returning({ id: invitations.id, role: invitations.role });
  if (!claimed)
    throw new AccountError(
      'INVITATION_INVALID',
      'This invitation is invalid, expired or already used',
    );
  const role: Role = claimed.role === 'admin' ? 'admin' : 'member';
  try {
    const user = await createCredentialUser(auth, parsed.data, role);
    await db.update(invitations).set({ usedBy: user.id }).where(eq(invitations.id, claimed.id));
    return { userId: user.id, role };
  } catch (error) {
    // Release the invitation so the invitee can retry (e.g. with another email).
    await db.update(invitations).set({ usedAt: null }).where(eq(invitations.id, claimed.id));
    throw error;
  }
}

/** One-time bootstrap of the first administrator (local CLI only). */
export async function bootstrapAdmin(
  db: Database,
  auth: Auth,
  account: unknown,
): Promise<{ userId: string }> {
  const parsed = NewAccountSchema.safeParse(account);
  if (!parsed.success)
    throw new AccountError('INVALID_INPUT', 'Name, email or password is invalid');
  const [existing] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(authUsers)
    .where(eq(authUsers.role, 'admin'));
  if ((existing?.count ?? 0) > 0) {
    throw new AccountError(
      'ADMIN_EXISTS',
      'An administrator already exists; invite further admins instead',
    );
  }
  const user = await createCredentialUser(auth, parsed.data, 'admin');
  return { userId: user.id };
}

export async function listInvitations(db: Database) {
  return db
    .select({
      id: invitations.id,
      role: invitations.role,
      note: invitations.note,
      expiresAt: invitations.expiresAt,
      usedAt: invitations.usedAt,
      createdAt: invitations.createdAt,
    })
    .from(invitations)
    .orderBy(sql`${invitations.createdAt} desc`)
    .limit(100);
}
