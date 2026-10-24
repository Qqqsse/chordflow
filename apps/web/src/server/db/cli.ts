/**
 * Operator CLI for the database (run from apps/web):
 *   pnpm db:migrate     apply checked-in migrations
 *   pnpm db:seed-demo   load the synthetic demo catalog (fails if rows already exist)
 * Reads DATABASE_URL from the environment and never prints it.
 */
import snapshot from '../../../../../fixtures/contracts/catalog-demo.json';
import { DEMO_FIXTURE_FILES } from '../catalog/demo-catalog-files';
import { seedCatalog } from '../catalog/seed';
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
      default:
        console.error('usage: cli.ts <migrate|seed-demo>');
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
