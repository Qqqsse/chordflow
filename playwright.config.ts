import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './apps/web/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Runs the production build in demo mode: no database, worker or GPU.
    command: `pnpm --filter @chordflow/web exec next start -p ${port} -H 127.0.0.1`,
    url: `${baseURL}/api/v1/health`,
    reuseExistingServer: !process.env.CI,
    env: { CHORDFLOW_DATA_MODE: 'demo' },
    timeout: 60_000,
  },
});
