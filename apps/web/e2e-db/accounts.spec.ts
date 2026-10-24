import { expect, test, type Page } from '@playwright/test';
import { E2E_ADMIN } from '../../../playwright.config';

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('密碼').fill(password);
  await page.getByRole('button', { name: '登入' }).click();
}

test.describe.configure({ mode: 'serial' });

test('anonymous visitors see public licensed charts and a sign-in link', async ({ page }) => {
  await page.goto('/search?q=送別');
  await page
    .locator('[data-work-id="work_pd_songbie"]')
    .getByRole('link', { name: /開啟譜/ })
    .click();
  await expect(page.getByRole('heading', { name: '送別' })).toBeVisible();
  await expect(page.getByRole('link', { name: '登入' })).toBeVisible();
  const ready = await page.request.get('/api/v1/ready');
  expect((await ready.json()) as unknown).toMatchObject({
    data: { status: 'ready', checks: { database: 'ok' } },
  });
});

test('wrong password is rejected without revealing which part was wrong', async ({ page }) => {
  await login(page, E2E_ADMIN.email, 'definitely-wrong-password');
  await expect(page.getByRole('alert').filter({ hasText: 'Email 或密碼不正確' })).toBeVisible();
});

test('admin invites a friend who creates an account through the link', async ({
  page,
  browser,
}) => {
  await login(page, E2E_ADMIN.email, E2E_ADMIN.password);
  await expect(page.getByTestId('account-name')).toHaveText(E2E_ADMIN.name);
  await page.getByRole('link', { name: '管理' }).click();
  await page.getByRole('button', { name: '建立會員邀請' }).click();
  const link = (await page.getByTestId('invite-link').textContent()) ?? '';
  expect(link).toMatch(/\/invite#token=/);

  const guest = await browser.newContext();
  const friend = await guest.newPage();
  await friend.goto(link);
  await friend.getByLabel('顯示名稱').fill('朋友');
  await friend.getByLabel('Email').fill('friend@example.org');
  await friend.getByLabel('密碼（至少 12 個字元）').fill('friend-password-1');
  await friend.getByRole('button', { name: '建立帳號' }).click();
  await expect(friend.getByTestId('account-name')).toHaveText('朋友');
  await expect(friend.getByRole('link', { name: '管理' })).toHaveCount(0);

  // The same link cannot be used twice.
  const again = await browser.newContext();
  const stranger = await again.newPage();
  await stranger.goto(link);
  await stranger.getByLabel('顯示名稱').fill('陌生人');
  await stranger.getByLabel('Email').fill('stranger@example.org');
  await stranger.getByLabel('密碼（至少 12 個字元）').fill('stranger-password-1');
  await stranger.getByRole('button', { name: '建立帳號' }).click();
  await expect(stranger.getByRole('alert').filter({ hasText: '這個邀請無效' })).toBeVisible();
  await guest.close();
  await again.close();
});

test('members cannot use admin endpoints; cross-origin writes are refused', async ({ page }) => {
  await login(page, 'friend@example.org', 'friend-password-1');
  await expect(page.getByTestId('account-name')).toHaveText('朋友');
  const list = await page.request.get('/api/v1/invitations');
  expect(list.status()).toBe(403);
  const forged = await page.request.post('/api/v1/invitations', {
    data: { role: 'admin' },
    headers: { origin: 'https://evil.example' },
  });
  expect(forged.status()).toBe(403);
  expect(((await forged.json()) as { error: { code: string } }).error.code).toBe('CSRF_REJECTED');
});

test('signing out removes the account offline copies', async ({ page }) => {
  await login(page, 'friend@example.org', 'friend-password-1');
  await expect(page.getByTestId('account-name')).toHaveText('朋友');
  await page.goto('/charts/arr_pd_amazing_grace_001');
  await page.getByRole('button', { name: '儲存離線' }).click();
  await expect(page.getByTestId('save-offline')).toContainText('已儲存離線');
  await page.goto('/offline');
  await expect(page.getByTestId('offline-count')).toHaveText('共 1 份離線譜');
  await page.getByRole('button', { name: '登出' }).click();
  await expect(page.getByRole('link', { name: '登入' })).toBeVisible();
  await page.goto('/offline');
  await expect(page.getByTestId('offline-count')).toHaveText('共 0 份離線譜');
});
