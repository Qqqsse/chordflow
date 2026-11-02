import { expect, test, type Page } from '@playwright/test';
import { E2E_ADMIN } from '../../../playwright.config';

/* Private audio uploads: rights declaration, listing and withdrawal (M8-1). */

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(E2E_ADMIN.email);
  await page.getByLabel('密碼').fill(E2E_ADMIN.password);
  await page.getByRole('button', { name: '登入' }).click();
  await expect(page.getByTestId('account-name')).toBeVisible();
}

/** Synthetic WAV-shaped bytes; never real audio. */
function syntheticWav(seed: number): Buffer {
  const bytes = Buffer.alloc(2048, seed);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVE', 8, 'ascii');
  return bytes;
}

test.describe.configure({ mode: 'serial' });

test('uploads need an account and the terms page explains the rules', async ({ page }) => {
  expect((await page.request.get('/api/v1/audio-uploads')).status()).toBe(401);
  await page.goto('/uploads');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('link', { name: '使用條款' }).click();
  await expect(page.getByRole('heading', { name: '使用條款' })).toBeVisible();
  await expect(page.getByText('使用者上傳的內容由上傳者自行負責')).toBeVisible();
  await expect(page.getByText('上傳內容的合法性由我自行負責')).toBeVisible();
});

test('an admin uploads private audio after agreeing to the declaration, then deletes it', async ({
  page,
}) => {
  await login(page);
  await page.getByRole('link', { name: '我的音訊' }).click();
  await expect(page.getByRole('heading', { name: '我的音訊' })).toBeVisible();
  await expect(page.getByTestId('upload-limits')).toContainText('50 MB');

  const form = page.getByRole('form', { name: '上傳音訊' });
  await form.getByLabel('音訊檔').setInputFiles({
    name: 'morning-path.wav',
    mimeType: 'audio/wav',
    buffer: syntheticWav(7),
  });
  await form.getByLabel('歌名').fill('晨光小路（自錄）');
  // Without the declaration the browser refuses to submit.
  await form.getByRole('button', { name: '上傳' }).click();
  await expect(page.getByTestId('upload-row')).toHaveCount(0);

  await form.getByRole('checkbox').check();
  await form.getByRole('button', { name: '上傳' }).click();
  await expect(page.getByRole('status')).toHaveText('已上傳。');
  const row = page.getByTestId('upload-row').filter({ hasText: '晨光小路（自錄）' });
  await expect(row).toContainText('WAV');
  await expect(row).toContainText('保存到');

  // The API never reveals where the audio is stored.
  const listed = await page.request.get('/api/v1/audio-uploads');
  expect(listed.status()).toBe(200);
  expect(await listed.text()).not.toContain('storage');

  page.once('dialog', (dialog) => void dialog.accept());
  await row.getByRole('button', { name: '刪除「晨光小路（自錄）」' }).click();
  await expect(row).toContainText('已刪除');
  await expect(row.getByRole('button', { name: /刪除/ })).toHaveCount(0);
});

test('a file that is not audio is refused with an explanation', async ({ page }) => {
  await login(page);
  await page.goto('/uploads');
  const form = page.getByRole('form', { name: '上傳音訊' });
  await form.getByLabel('音訊檔').setInputFiles({
    name: 'notes.wav',
    mimeType: 'audio/wav',
    buffer: Buffer.from('<!doctype html><title>not audio</title>'),
  });
  await form.getByLabel('歌名').fill('不是音訊');
  await form.getByRole('checkbox').check();
  await form.getByRole('button', { name: '上傳' }).click();
  await expect(page.getByRole('status')).toContainText('不支援這個檔案格式');
});
