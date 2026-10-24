import {
  MAX_RECENT_CHARTS,
  ViewerPreferencesSchema,
  type LibraryData,
  type LibraryItem,
  type ViewerPreferences,
} from '@chordflow/chart-schema';
import { and, desc, eq, notInArray, sql } from 'drizzle-orm';
import type { Principal } from '../access';
import { requireVisibleArrangement } from '../catalog/lookups';
import { createPgCatalog } from '../catalog/pg-repository';
import { toArrangementSummary, visibleArrangement } from '../catalog/views';
import { favorites, recentViews, userChartPreferences } from '../db/auth-schema';
import type { Database } from '../db/client';

/*
 * Personal library (SPEC §4 item 12, §8). Every operation first checks that
 * the user can still see the arrangement; access can change after something
 * was favorited, so listings are filtered again on read.
 */

export interface LibraryUser {
  userId: string;
  role: 'member' | 'admin';
}

const principalOf = (user: LibraryUser): Principal => ({
  kind: 'user',
  userId: user.userId,
  role: user.role,
});
const iso = (value: Date) => value.toISOString();

async function requireVisible(db: Database, user: LibraryUser, arrangementId: string) {
  return requireVisibleArrangement(createPgCatalog(db), principalOf(user), arrangementId);
}

export async function setFavorite(
  db: Database,
  user: LibraryUser,
  arrangementId: string,
  favorite: boolean,
): Promise<{ arrangementId: string; favorite: boolean }> {
  if (favorite) {
    await requireVisible(db, user, arrangementId);
    await db.insert(favorites).values({ userId: user.userId, arrangementId }).onConflictDoNothing();
  } else {
    // Removing never needs visibility: a user may always clean up their own list.
    await db
      .delete(favorites)
      .where(and(eq(favorites.userId, user.userId), eq(favorites.arrangementId, arrangementId)));
  }
  return { arrangementId, favorite };
}

export async function isFavorite(db: Database, userId: string, arrangementId: string) {
  const [row] = await db
    .select({ id: favorites.arrangementId })
    .from(favorites)
    .where(and(eq(favorites.userId, userId), eq(favorites.arrangementId, arrangementId)));
  return row !== undefined;
}

export async function getPreferences(db: Database, user: LibraryUser, arrangementId: string) {
  await requireVisible(db, user, arrangementId);
  const [row] = await db
    .select()
    .from(userChartPreferences)
    .where(
      and(
        eq(userChartPreferences.userId, user.userId),
        eq(userChartPreferences.arrangementId, arrangementId),
      ),
    );
  // Stored values from an older or unknown format are ignored rather than trusted.
  const parsed = row === undefined ? null : ViewerPreferencesSchema.safeParse(row.preferences);
  return {
    arrangementId,
    preferences: parsed?.success === true ? parsed.data : null,
    updatedAt: parsed?.success === true && row !== undefined ? iso(row.updatedAt) : null,
  };
}

export async function savePreferences(
  db: Database,
  user: LibraryUser,
  arrangementId: string,
  preferences: ViewerPreferences,
) {
  await requireVisible(db, user, arrangementId);
  const [row] = await db
    .insert(userChartPreferences)
    .values({ userId: user.userId, arrangementId, preferences })
    .onConflictDoUpdate({
      target: [userChartPreferences.userId, userChartPreferences.arrangementId],
      set: { preferences, updatedAt: sql`now()` },
    })
    .returning({ updatedAt: userChartPreferences.updatedAt });
  return { arrangementId, preferences, updatedAt: row ? iso(row.updatedAt) : null };
}

/** Records an opened chart and keeps only the newest MAX_RECENT_CHARTS per user. */
export async function recordView(db: Database, user: LibraryUser, arrangementId: string) {
  await requireVisible(db, user, arrangementId);
  await db.transaction(async (tx) => {
    await tx
      .insert(recentViews)
      .values({ userId: user.userId, arrangementId })
      .onConflictDoUpdate({
        target: [recentViews.userId, recentViews.arrangementId],
        set: { viewedAt: sql`now()` },
      });
    const keep = tx
      .select({ id: recentViews.arrangementId })
      .from(recentViews)
      .where(eq(recentViews.userId, user.userId))
      .orderBy(desc(recentViews.viewedAt), desc(recentViews.arrangementId))
      .limit(MAX_RECENT_CHARTS);
    await tx
      .delete(recentViews)
      .where(and(eq(recentViews.userId, user.userId), notInArray(recentViews.arrangementId, keep)));
  });
}

async function toItems(
  db: Database,
  user: LibraryUser,
  rows: readonly { arrangementId: string; at: Date }[],
): Promise<LibraryItem[]> {
  const repo = createPgCatalog(db);
  const items: LibraryItem[] = [];
  for (const row of rows) {
    const arrangement = await repo.getArrangement(row.arrangementId);
    if (arrangement === null || !(await visibleArrangement(repo, principalOf(user), arrangement)))
      continue;
    const work = await repo.getWork(arrangement.workId);
    if (work === null) continue;
    items.push({
      arrangement: toArrangementSummary(arrangement),
      work: { id: work.id, title: work.title },
      at: iso(row.at),
    });
  }
  return items;
}

export async function getLibrary(db: Database, user: LibraryUser): Promise<LibraryData> {
  const [favoriteRows, recentRows] = await Promise.all([
    db
      .select({ arrangementId: favorites.arrangementId, at: favorites.createdAt })
      .from(favorites)
      .where(eq(favorites.userId, user.userId))
      .orderBy(desc(favorites.createdAt), desc(favorites.arrangementId))
      .limit(200),
    db
      .select({ arrangementId: recentViews.arrangementId, at: recentViews.viewedAt })
      .from(recentViews)
      .where(eq(recentViews.userId, user.userId))
      .orderBy(desc(recentViews.viewedAt), desc(recentViews.arrangementId))
      .limit(MAX_RECENT_CHARTS),
  ]);
  return {
    favorites: await toItems(db, user, favoriteRows),
    recent: await toItems(db, user, recentRows),
  };
}
