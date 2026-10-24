import 'server-only';
import { ApiProblem } from '@/lib/api/handler';
import { getDatabase } from '../catalog';
import type { Database } from '../db/client';
import { getPrincipal } from './principal';

export interface SignedIn {
  db: Database;
  userId: string;
  role: 'member' | 'admin';
}

/** Database mode + signed-in user; demo mode has no write or account features. */
export async function requireUser(request: Request): Promise<SignedIn> {
  const handle = getDatabase();
  if (handle === null) throw new ApiProblem(404, 'NOT_FOUND', 'Not available in demo mode');
  const principal = await getPrincipal(request);
  if (principal.kind === 'anonymous')
    throw new ApiProblem(401, 'UNAUTHENTICATED', 'Sign in required');
  return { db: handle.db, userId: principal.userId, role: principal.role };
}

export async function requireAdmin(request: Request): Promise<SignedIn> {
  const user = await requireUser(request);
  if (user.role !== 'admin') throw new ApiProblem(403, 'FORBIDDEN', 'Administrators only');
  return user;
}
