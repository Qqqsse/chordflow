import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/db/schema.ts',
  out: './drizzle',
  // Only used by `drizzle-kit migrate`/`studio`; generation needs no database.
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  strict: true,
});
