import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${port}`;

/**
 * Database-mode suite: runs only when TEST_DATABASE_URL points at a disposable
 * database. The server command resets it (drop + migrate + seed) and creates
 * the e2e administrator before starting.
 */
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const dbPort = port + 1;
const dbBaseURL = `http://127.0.0.1:${dbPort}`;
export const E2E_ADMIN = {
  email: 'e2e-admin@example.org',
  name: '測試管理員',
  password: 'e2e-admin-password-1',
};
const dbEnv = {
  CHORDFLOW_DATA_MODE: 'database',
  DATABASE_URL: testDatabaseUrl ?? '',
  APP_BASE_URL: dbBaseURL,
  BETTER_AUTH_SECRET: 'e2e-only-secret-not-for-production-use-0123456789',
  CHORDFLOW_ALLOW_DESTRUCTIVE_RESET: 'yes',
  ADMIN_EMAIL: E2E_ADMIN.email,
  ADMIN_NAME: E2E_ADMIN.name,
  ADMIN_PASSWORD: E2E_ADMIN.password,
};

export default defineConfig({
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', testDir: './apps/web/e2e', use: { ...devices['Desktop Chrome'] } },
    ...(testDatabaseUrl
      ? [
          {
            name: 'chromium-database',
            testDir: './apps/web/e2e-db',
            fullyParallel: false,
            workers: 1,
            use: { ...devices['Desktop Chrome'], baseURL: dbBaseURL },
          },
        ]
      : []),
  ],
  webServer: [
    {
      // Production build in demo mode: no database, worker or GPU.
      command: `pnpm --filter @chordflow/web exec next start -p ${port} -H 127.0.0.1`,
      url: `${baseURL}/api/v1/health`,
      reuseExistingServer: !process.env.CI,
      env: { CHORDFLOW_DATA_MODE: 'demo' },
      timeout: 60_000,
    },
    ...(testDatabaseUrl
      ? [
          {
            command: `pnpm --filter @chordflow/web db:reset-test && pnpm --filter @chordflow/web admin:create && pnpm --filter @chordflow/web exec next start -p ${dbPort} -H 127.0.0.1`,
            url: `${dbBaseURL}/api/v1/ready`,
            reuseExistingServer: false,
            env: dbEnv,
            timeout: 120_000,
          },
        ]
      : []),
  ],
});
