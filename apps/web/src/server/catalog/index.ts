import 'server-only';
import { readRuntimeConfig } from '@/lib/config';
import { openDatabase, type DatabaseHandle } from '../db/client';
import { getDemoCatalog } from './demo-catalog';
import { createPgCatalog } from './pg-repository';
import type { CatalogRepository } from './repository';

let handle: DatabaseHandle | undefined;
let pgCatalog: CatalogRepository | undefined;

/** Database handle for database mode (lazily opened, shared per server process). */
export function getDatabase(): DatabaseHandle | null {
  const config = readRuntimeConfig(process.env);
  if (config.dataMode !== 'database') return null;
  handle ??= openDatabase(process.env.DATABASE_URL ?? '');
  return handle;
}

/** The catalog for the configured data mode: synthetic fixtures (demo) or PostgreSQL. */
export function getCatalog(): CatalogRepository {
  const db = getDatabase();
  if (db === null) return getDemoCatalog();
  pgCatalog ??= createPgCatalog(db.db);
  return pgCatalog;
}
