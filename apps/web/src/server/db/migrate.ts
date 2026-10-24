import path from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { Database } from './client';

/** Directory with the checked-in SQL migrations (apps/web/drizzle). */
export const MIGRATIONS_FOLDER = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../../../drizzle',
);

export async function runMigrations(
  db: Database,
  folder: string = MIGRATIONS_FOLDER,
): Promise<void> {
  await migrate(db, { migrationsFolder: folder });
}
