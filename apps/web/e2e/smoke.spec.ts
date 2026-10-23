import { expect, test } from '@playwright/test';

test('home page renders in zh-TW and links to the demo', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-TW');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.getByRole('link', { name: '開啟示範譜' }).click();
  await expect(page).toHaveURL(/\/demo$/);
});

test('demo chart renders without database or GPU', async ({ page }) => {
  await page.goto('/demo');
  await expect(page.getByRole('heading', { name: '示範歌曲（虛構）' })).toBeVisible();
  await expect(page.getByRole('region', { name: '主歌' })).toContainText('微風帶我');
  const slashChord = page.locator('[data-chord-id="ch_verse_2"]');
  await expect(slashChord).toContainText('G/B');
  await expect(slashChord).toContainText('向前走');
});

test('health endpoint reports liveness without secrets', async ({ request }) => {
  const res = await request.get('/api/v1/health');
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { data: { status: string; dataMode: string } };
  expect(body.data.status).toBe('ok');
  expect(body.data.dataMode).toBe('demo');
  expect(res.headers()['x-request-id']).toMatch(/^req_/);
});

test('demo page has no horizontal overflow at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/demo');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
