import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as authSchema from './auth-schema';
import * as catalogSchema from './schema';

const schema = { ...catalogSchema, ...authSchema };

export type Database = PostgresJsDatabase<typeof schema>;

export interface DatabaseHandle {
  db: Database;
  close: () => Promise<void>;
}

/** Opens a pooled connection. Credentials come only from the URL; nothing is logged. */
export function openDatabase(url: string, options: { max?: number } = {}): DatabaseHandle {
  const client = postgres(url, { max: options.max ?? 10, onnotice: () => undefined });
  return {
    db: drizzle(client, { schema }),
    close: () => client.end({ timeout: 5 }),
  };
}
