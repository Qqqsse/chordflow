/**
 * Operator CLI for the database (run from apps/web):
 *   pnpm db:migrate      apply checked-in migrations
 *   pnpm db:seed-demo    load the synthetic demo catalog (fails if rows already exist)
 *   pnpm admin:create    one-time bootstrap of the first administrator from
 *                        ADMIN_EMAIL / ADMIN_NAME / ADMIN_PASSWORD (refuses if an admin exists)
 *   pnpm db:reset-test   DROP and recreate the schema, migrate, seed — only with
 *                        CHORDFLOW_ALLOW_DESTRUCTIVE_RESET=yes (tests/CI only)
 * Reads DATABASE_URL (and APP_BASE_URL / BETTER_AUTH_SECRET for accounts) from
 * the environment and never prints secrets.
 */
import snapshot from '../../../../../fixtures/contracts/catalog-demo.json';
import { DEMO_FIXTURE_FILES } from '../catalog/demo-catalog-files';
import { seedCatalog } from '../catalog/seed';
import { sql } from 'drizzle-orm';
import { createAuth, readAuthConfig } from '../auth/auth';
import { AccountError, bootstrapAdmin } from '../auth/invitations';
import { openDatabase } from './client';
import { runMigrations } from './migrate';

async function main(command: string | undefined): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === '') {
    console.error('DATABASE_URL is not set');
    return 2;
  }
  const handle = openDatabase(url, { max: 1 });
  try {
    switch (command) {
      case 'migrate':
        await runMigrations(handle.db);
        console.log('migrations applied');
        return 0;
      case 'seed-demo':
        await seedCatalog(handle.db, snapshot, DEMO_FIXTURE_FILES);
        console.log('demo catalog loaded');
        return 0;
      case 'admin-create': {
        const auth = createAuth(handle.db, readAuthConfig(process.env));
        try {
          const { userId } = await bootstrapAdmin(handle.db, auth, {
            email: process.env.ADMIN_EMAIL ?? '',
            name: process.env.ADMIN_NAME ?? '',
            password: process.env.ADMIN_PASSWORD ?? '',
          });
          console.log(`administrator created (${userId})`);
          return 0;
        } catch (error) {
          if (error instanceof AccountError) {
            console.error(`${error.code}: ${error.message}`);
            return 1;
          }
          throw error;
        }
      }
      case 'reset-test':
        if (process.env.CHORDFLOW_ALLOW_DESTRUCTIVE_RESET !== 'yes') {
          console.error(
            'refusing: set CHORDFLOW_ALLOW_DESTRUCTIVE_RESET=yes (this drops every table)',
          );
          return 2;
        }
        await handle.db.execute(
          sql.raw(
            'drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;',
          ),
        );
        await runMigrations(handle.db);
        await seedCatalog(handle.db, snapshot, DEMO_FIXTURE_FILES);
        console.log('test database reset');
        return 0;
      default:
        console.error('usage: cli.ts <migrate|seed-demo|admin-create|reset-test>');
        return 2;
    }
  } finally {
    await handle.close();
  }
}

main(process.argv[2]).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? `${error.name}: ${error.message}` : 'unexpected error');
    process.exitCode = 1;
  },
);
