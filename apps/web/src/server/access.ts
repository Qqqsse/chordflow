import {
  rightsAllowVisibility,
  type Arrangement,
  type ChartRevision,
} from '@chordflow/chart-schema';

/*
 * Server-side authorization rules (SPEC §12). Anonymous visitors only see
 * public arrangements whose content rights allow it; members also see shared
 * ones and their own private ones; admins see everything. Drafts and other
 * unpublished revisions are visible to admins and the arrangement owner only.
 */

export type Role = 'member' | 'admin';

export type Principal = { kind: 'anonymous' } | { kind: 'user'; userId: string; role: Role };

export const ANONYMOUS: Principal = { kind: 'anonymous' };

/** Minimal arrangement fields needed for access decisions. */
export type AccessArrangement = Pick<Arrangement, 'visibility' | 'rights'> & {
  ownerUserId?: string | null;
};

export function canViewArrangement(principal: Principal, arrangement: AccessArrangement): boolean {
  if (principal.kind === 'user' && principal.role === 'admin') return true;
  if (principal.kind === 'user' && arrangement.ownerUserId === principal.userId) return true;
  const { visibility } = arrangement;
  if (visibility === 'private') return false;
  // Visibility never overrides missing redistribution rights (fail closed).
  if (!rightsAllowVisibility(arrangement.rights, visibility)) return false;
  if (visibility === 'public') return true;
  return principal.kind === 'user'; // shared: any signed-in member
}

export function canViewRevision(
  principal: Principal,
  arrangement: AccessArrangement & Pick<Arrangement, 'publishedRevisionId'>,
  revision: Pick<ChartRevision, 'id' | 'status'>,
): boolean {
  if (!canViewArrangement(principal, arrangement)) return false;
  if (revision.status === 'published') return true;
  if (principal.kind !== 'user') return false;
  return principal.role === 'admin' || arrangement.ownerUserId === principal.userId;
}

export function isAdmin(principal: Principal): boolean {
  return principal.kind === 'user' && principal.role === 'admin';
}
