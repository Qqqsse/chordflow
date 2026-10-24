import { expect, test } from '@playwright/test';

test.describe('catalog search', () => {
  test('search from the home page and open a published chart', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('歌名、歌手或來源網址').fill('送別');
    await page.getByRole('button', { name: '搜尋' }).click();
    await expect(page).toHaveURL(/\/search\?q=/);
    const hit = page.locator('[data-work-id="work_pd_songbie"]');
    await expect(hit).toContainText('詞：李叔同');
    await hit.getByRole('link', { name: /開啟譜/ }).click();
    await expect(page).toHaveURL(/\/charts\/arr_pd_songbie_001$/);
    await expect(page.getByRole('heading', { name: '送別' })).toBeVisible();
    await expect(page.locator('[data-chord-id="sb_c10"] .chord-label')).toHaveText('C');
  });

  test('searching by artist shows recordings with their verification state', async ({ page }) => {
    await page.goto('/search?q=示範歌手甲');
    const hit = page.locator('[data-work-id="work_demo_001"]');
    await hit.getByText(/錄音版本/).click();
    await expect(hit.locator('[data-recording-id="rec_demo_002"]')).toContainText('現場版');
    await expect(hit.locator('[data-recording-id="rec_demo_003"]')).toContainText('建議（未驗證）');
  });

  test('a supported source URL is matched without fetching; others are refused', async ({ page }) => {
    await page.goto(`/search?q=${encodeURIComponent('https://www.youtube.com/watch?v=DEMO0000001')}`);
    await expect(page.locator('[data-work-id="work_demo_001"]')).toBeVisible();
    await page.goto(`/search?q=${encodeURIComponent('https://evil.example/song')}`);
    await expect(page.getByRole('alert').filter({ hasText: '不支援這個網址' })).toBeVisible();
  });

  test('unknown charts are 404', async ({ page }) => {
    const response = await page.goto('/charts/arr_missing');
    expect(response?.status()).toBe(404);
  });
});
