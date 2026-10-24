import { MAX_RECENT_CHARTS, type ViewerPreferences } from '@chordflow/chart-schema';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { ApiProblem } from '@/lib/api/handler';
import { createArrangement, updateArrangementSettings } from '../catalog/editor';
import { authUsers, userChartPreferences } from '../db/auth-schema';
import type { Database, DatabaseHandle } from '../db/client';
import * as t from '../db/schema';
import {
  getLibrary,
  getPreferences,
  isFavorite,
  recordView,
  savePreferences,
  setFavorite,
  type LibraryUser,
} from './service';

const PREFS: ViewerPreferences = {
  version: 1,
  transposeSemitones: 2,
  capoFret: 2,
  capoMode: 'keep_shape',
  show: 'sounding',
  notation: 'nashville',
  fontSize: 24,
  voicingChoices: { C: 'v_x32010' },
  showDiagrams: false,
  readingMode: 'pages',
  scrollSpeed: 40,
};

const synthetic = {
  lyrics: 'synthetic',
  chart: 'synthetic',
  audio: 'unknown',
  attribution: null,
  notes: null,
} as const;

const expectNotFound = async (work: Promise<unknown>) => {
  await expect(work).rejects.toSatisfy((e: unknown) => e instanceof ApiProblem && e.status === 404);
};

/** Personal library suite; registered by `../db.integration.test.ts` after the accounts suite. */
export function libraryIntegrationSuite(getHandle: () => DatabaseHandle): void {
  describe('personal library', () => {
    let db: Database;
    let admin: LibraryUser;
    const member: LibraryUser = { userId: 'usr_library_member', role: 'member' };
    let publicArrangement: string;
    let adminPrivate: string;

    const newArrangement = async (owner: string, name: string, visibility: 'private' | 'public') =>
      (
        await createArrangement(
          db,
          {
            work: { title: name, titleAliases: [], language: 'zh-TW', artistName: null },
            name,
            variant: 'original',
            visibility,
            rights: synthetic,
          },
          owner,
        )
      ).arrangementId;

    beforeAll(async () => {
      db = getHandle().db;
      const [row] = await db
        .select({ id: authUsers.id })
        .from(authUsers)
        .where(eq(authUsers.role, 'admin'))
        .limit(1);
      if (!row) throw new Error('accounts suite must create an admin first');
      admin = { userId: row.id, role: 'admin' };
      await db
        .insert(authUsers)
        .values({ id: member.userId, name: '譜庫成員', email: 'library-member@example.org' })
        .onConflictDoNothing();
      publicArrangement = await newArrangement(admin.userId, '公開測試譜', 'public');
      adminPrivate = await newArrangement(admin.userId, '管理員私人譜', 'private');
    });

    it('favorites are idempotent and limited to visible arrangements', async () => {
      await setFavorite(db, member, publicArrangement, true);
      await setFavorite(db, member, publicArrangement, true);
      expect(await isFavorite(db, member.userId, publicArrangement)).toBe(true);
      // Hidden and missing arrangements look the same.
      await expectNotFound(setFavorite(db, member, adminPrivate, true));
      await expectNotFound(setFavorite(db, member, 'arr_does_not_exist', true));
      const library = await getLibrary(db, member);
      expect(library.favorites.map((f) => f.arrangement.id)).toEqual([publicArrangement]);
      expect(library.favorites[0]?.work.title).toBe('公開測試譜');
      await setFavorite(db, member, publicArrangement, false);
      await setFavorite(db, member, publicArrangement, false);
      expect((await getLibrary(db, member)).favorites).toEqual([]);
    });

    it('drops items from listings when the arrangement is no longer visible', async () => {
      const id = await newArrangement(admin.userId, '之後改為私人', 'public');
      await setFavorite(db, member, id, true);
      await recordView(db, member, id);
      await updateArrangementSettings(
        db,
        id,
        { visibility: 'private', rights: synthetic },
        admin.userId,
      );
      const library = await getLibrary(db, member);
      expect(library.favorites.map((f) => f.arrangement.id)).not.toContain(id);
      expect(library.recent.map((r) => r.arrangement.id)).not.toContain(id);
      // The admin still sees it.
      await setFavorite(db, admin, id, true);
      expect((await getLibrary(db, admin)).favorites.map((f) => f.arrangement.id)).toContain(id);
    });

    it('keeps only the newest recent charts, newest first', async () => {
      const ids: string[] = [];
      for (let i = 0; i < MAX_RECENT_CHARTS + 2; i += 1) {
        ids.push(await newArrangement(member.userId, `我的練習譜 ${String(i)}`, 'private'));
      }
      for (const id of ids) await recordView(db, member, id);
      // Re-opening an older chart moves it to the top.
      await recordView(db, member, ids[5] ?? '');
      const recent = (await getLibrary(db, member)).recent.map((r) => r.arrangement.id);
      expect(recent).toHaveLength(MAX_RECENT_CHARTS);
      expect(recent[0]).toBe(ids[5]);
      expect(recent).not.toContain(ids[0]);
      expect(recent).not.toContain(ids[1]);
      await expectNotFound(recordView(db, member, adminPrivate));
    });

    it('saves viewer preferences per user without touching the chart', async () => {
      const before = await db
        .select({ updatedAt: t.arrangements.updatedAt })
        .from(t.arrangements)
        .where(eq(t.arrangements.id, publicArrangement));
      expect(await getPreferences(db, member, publicArrangement)).toEqual({
        arrangementId: publicArrangement,
        preferences: null,
        updatedAt: null,
      });
      const saved = await savePreferences(db, member, publicArrangement, PREFS);
      expect(saved.preferences).toEqual(PREFS);
      const again = await savePreferences(db, member, publicArrangement, {
        ...PREFS,
        fontSize: 18,
      });
      expect((await getPreferences(db, member, publicArrangement)).preferences?.fontSize).toBe(18);
      expect(again.updatedAt).not.toBeNull();
      // Another user's preferences are separate.
      expect((await getPreferences(db, admin, publicArrangement)).preferences).toBeNull();
      await expectNotFound(savePreferences(db, member, adminPrivate, PREFS));
      const after = await db
        .select({ updatedAt: t.arrangements.updatedAt })
        .from(t.arrangements)
        .where(eq(t.arrangements.id, publicArrangement));
      expect(after).toEqual(before);
    });

    it('ignores stored preferences that no longer match the contract', async () => {
      await db
        .update(userChartPreferences)
        .set({ preferences: { version: 0, fontSize: 'huge' } })
        .where(eq(userChartPreferences.userId, member.userId));
      expect((await getPreferences(db, member, publicArrangement)).preferences).toBeNull();
    });
  });
}
