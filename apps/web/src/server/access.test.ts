import type { ContentRights } from '@chordflow/chart-schema';
import { describe, expect, it } from 'vitest';
import { ANONYMOUS, canViewArrangement, canViewRevision, type Principal } from './access';

const synthetic: ContentRights = {
  lyrics: 'synthetic',
  chart: 'synthetic',
  audio: 'unknown',
  attribution: null,
  notes: null,
};
const unknown: ContentRights = { ...synthetic, lyrics: 'unknown', chart: 'unknown' };
const member: Principal = { kind: 'user', userId: 'u1', role: 'member' };
const other: Principal = { kind: 'user', userId: 'u2', role: 'member' };
const admin: Principal = { kind: 'user', userId: 'a1', role: 'admin' };

describe('canViewArrangement', () => {
  it.each<
    [string, Principal, 'private' | 'shared' | 'public', ContentRights, string | null, boolean]
  >([
    ['anonymous sees public licensed content', ANONYMOUS, 'public', synthetic, null, true],
    ['anonymous never sees shared content', ANONYMOUS, 'shared', synthetic, null, false],
    ['anonymous never sees private content', ANONYMOUS, 'private', synthetic, null, false],
    ['unknown rights fail closed even when public', ANONYMOUS, 'public', unknown, null, false],
    ['members see shared content', member, 'shared', synthetic, null, true],
    ['members do not see shared content without rights', member, 'shared', unknown, null, false],
    ['members see their own private content', member, 'private', unknown, 'u1', true],
    ["members do not see someone else's private content", other, 'private', synthetic, 'u1', false],
    ['admins see everything', admin, 'private', unknown, 'u1', true],
  ])('%s', (_name, principal, visibility, rights, ownerUserId, expected) => {
    expect(canViewArrangement(principal, { visibility, rights, ownerUserId })).toBe(expected);
  });
});

describe('canViewRevision', () => {
  const arrangement = {
    visibility: 'public' as const,
    rights: synthetic,
    ownerUserId: 'u1',
    publishedRevisionId: 'r1',
  };

  it('published revisions follow arrangement access', () => {
    expect(canViewRevision(ANONYMOUS, arrangement, { id: 'r1', status: 'published' })).toBe(true);
  });

  it('drafts are only for the owner and admins', () => {
    const draft = { id: 'r2', status: 'draft' as const };
    expect(canViewRevision(ANONYMOUS, arrangement, draft)).toBe(false);
    expect(canViewRevision(other, arrangement, draft)).toBe(false);
    expect(canViewRevision(member, arrangement, draft)).toBe(true);
    expect(canViewRevision(admin, arrangement, draft)).toBe(true);
  });
});
