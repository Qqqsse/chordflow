import { expect, test, type Page } from '@playwright/test';
import { E2E_ADMIN } from '../../../playwright.config';

/* Personal library: favorites, recently opened and viewer settings saved per account. */

const CHART = '/charts/arr_pd_songbie_001';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(E2E_ADMIN.email);
  await page.getByLabel('密碼').fill(E2E_ADMIN.password);
  await page.getByRole('button', { name: '登入' }).click();
  await expect(page.getByTestId('account-name')).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

test('anonymous readers get the plain viewer and the library needs sign-in', async ({ page }) => {
  await page.goto(CHART);
  await expect(page.getByRole('heading', { name: '送別' })).toBeVisible();
  await expect(page.getByRole('button', { name: /加入收藏/ })).toHaveCount(0);
  const library = await page.request.get('/api/v1/me/library');
  expect(library.status()).toBe(401);
  await page.goto('/library');
  await expect(page).toHaveURL(/\/login$/);
});

test('favorite, saved viewer settings and recent charts follow the account', async ({ page }) => {
  await login(page);
  await page.goto(CHART);
  const favorite = page.getByRole('button', { name: '☆ 加入收藏' });
  await expect(favorite).toBeEnabled();
  await favorite.click();
  await expect(page.getByRole('button', { name: '★ 已收藏' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // Change settings; they are saved to the account, not to the chart.
  await page.getByRole('button', { name: '升半音' }).click();
  await page.getByRole('button', { name: '升半音' }).click();
  await page.getByLabel('移調夾格數').selectOption('2');
  await expect(page.getByTestId('preference-status')).toHaveText('看譜設定已儲存。');
  const transposed = await page.getByTestId('transpose-value').textContent();

  // A fresh page load restores them.
  await page.reload();
  await expect(page.getByTestId('transpose-value')).toHaveText(transposed ?? '');
  await expect(page.getByLabel('移調夾格數')).toHaveValue('2');

  // The published chart itself is unchanged for everyone else.
  const chart = await page.request.get('/api/v1/arrangements/arr_pd_songbie_001');
  const detail = (await chart.json()) as { data: { arrangement: { publishedRevisionId: string } } };
  expect(detail.data.arrangement.publishedRevisionId).toBeTruthy();

  await page.getByRole('link', { name: '我的譜庫' }).click();
  await expect(page.getByRole('heading', { name: '我的譜庫' })).toBeVisible();
  await expect(page.getByRole('list', { name: '收藏的譜' })).toContainText('送別');
  await expect(page.getByRole('list', { name: '最近開啟的譜' })).toContainText('送別');

  // Removing the favorite empties the list again.
  await page.goto(CHART);
  await page.getByRole('button', { name: '★ 已收藏' }).click();
  await expect(page.getByRole('button', { name: '☆ 加入收藏' })).toBeVisible();
  await page.goto('/library');
  await expect(page.getByText('還沒有收藏')).toBeVisible();
});

test('preference writes are validated and same-origin only', async ({ page }) => {
  await login(page);
  const origin = { origin: new URL(page.url()).origin };
  const bad = await page.request.put('/api/v1/me/preferences/arr_pd_songbie_001', {
    data: { version: 1, fontSize: 999 },
    headers: origin,
  });
  expect(bad.status()).toBe(422);
  const crossSite = await page.request.put('/api/v1/me/favorites/arr_pd_songbie_001', {
    data: {},
    headers: { origin: 'https://evil.example' },
  });
  expect(crossSite.status()).toBe(403);
});
