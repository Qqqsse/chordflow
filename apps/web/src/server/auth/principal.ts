import 'server-only';
import { ANONYMOUS, type Principal, type Role } from '../access';
import { getAuth } from '.';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

/** Signed-in user for these request headers, or null (demo mode is always anonymous). */
export async function getSessionUser(headers: Headers): Promise<SessionUser | null> {
  const auth = getAuth();
  if (auth === null) return null;
  const session = await auth.api.getSession({ headers });
  if (session === null) return null;
  const role: unknown = (session.user as { role?: unknown }).role;
  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    role: role === 'admin' ? 'admin' : 'member',
  };
}

export async function getPrincipalFromHeaders(headers: Headers): Promise<Principal> {
  const user = await getSessionUser(headers);
  return user === null ? ANONYMOUS : { kind: 'user', userId: user.id, role: user.role };
}

export function getPrincipal(request: Request): Promise<Principal> {
  return getPrincipalFromHeaders(request.headers);
}
