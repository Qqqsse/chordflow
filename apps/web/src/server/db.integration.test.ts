import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe } from 'vitest';
import snapshot from '../../../../fixtures/contracts/catalog-demo.json';
import { authIntegrationSuite } from './auth/auth.integration';
import { DEMO_FIXTURE_FILES } from './catalog/demo-catalog-files';
import { editorIntegrationSuite } from './catalog/editor.integration';
import { catalogIntegrationSuite } from './catalog/pg-repository.integration';
import { seedCatalog } from './catalog/seed';
import { openDatabase, type DatabaseHandle } from './db/client';
import { runMigrations } from './db/migrate';
import { jobsIntegrationSuite } from './jobs/jobs.integration';

/**
 * PostgreSQL integration tests, in one file so suites never race on the same
 * database. Runs only when TEST_DATABASE_URL points at a disposable database:
 * the public schema is dropped and recreated.
 */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('PostgreSQL integration', () => {
  let handle: DatabaseHandle | undefined;
  const getHandle = (): DatabaseHandle => {
    if (!handle) throw new Error('database not initialized');
    return handle;
  };

  beforeAll(async () => {
    handle = openDatabase(url ?? '', { max: 4 });
    await handle.db.execute(
      sql.raw(
        'drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;',
      ),
    );
    await runMigrations(handle.db);
    await seedCatalog(handle.db, snapshot, DEMO_FIXTURE_FILES);
  }, 60_000);

  afterAll(async () => {
    await handle?.close();
  });

  catalogIntegrationSuite(getHandle);
  authIntegrationSuite(getHandle);
  editorIntegrationSuite(getHandle);
  jobsIntegrationSuite(getHandle);
});
