import { expect, test, type Page } from '@playwright/test';
import { E2E_ADMIN } from '../../../playwright.config';

const CHORDPRO = `{title: 小城黃昏（虛構）}
{artist: 測試歌手乙}
{key: C}
{capo: 2}

{start_of_verse}
[C]小城的[G/B]黃昏 [Am]慢慢地[F]來
{end_of_verse}
`;

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('密碼').fill(password);
  await page.getByRole('button', { name: '登入' }).click();
  await expect(page.getByTestId('account-name')).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

test('anonymous and member callers cannot write', async ({ page, request }) => {
  const origin = {
    origin: new URL(page.url() === 'about:blank' ? 'http://127.0.0.1:3101' : page.url()).origin,
  };
  const anon = await request.post('/api/v1/chordpro/import', {
    data: { source: CHORDPRO },
    headers: origin,
  });
  expect(anon.status()).toBe(401);
  await login(page, 'friend@example.org', 'friend-password-1');
  const member = await page.request.post('/api/v1/arrangements', {
    data: {
      work: { title: 'x' },
      name: 'x',
      rights: {
        lyrics: 'unknown',
        chart: 'unknown',
        audio: 'unknown',
        attribution: null,
        notes: null,
      },
    },
    headers: origin,
  });
  expect(member.status()).toBe(403);
});

test('admin imports ChordPro, resolves the capo question, publishes, and visitors can find it', async ({
  page,
  browser,
}) => {
  await login(page, E2E_ADMIN.email, E2E_ADMIN.password);
  await page.goto('/admin/import');
  await page.getByLabel('ChordPro 內容').fill(CHORDPRO);
  await page.getByRole('button', { name: '預覽' }).click();
  await expect(page.getByTestId('import-issues')).toContainText('CAPO_INTERPRETATION_REQUIRED');
  await page.getByLabel('檔案標示了移調夾，和弦是：').selectOption('capo_shapes');
  await page.getByRole('button', { name: '預覽' }).click();
  // Capo shapes are stored as concert chords: C shape + capo 2 sounds D.
  await expect(
    page.getByRole('region', { name: '預覽' }).locator('.chord-label').first(),
  ).toHaveText('D');

  await page.getByLabel('歌詞權利').selectOption('owner_original');
  await page.getByLabel('和弦譜權利').selectOption('owner_original');
  await page.getByLabel('可見度').selectOption('public');
  await page.getByRole('button', { name: '建立' }).click();
  await expect(page.getByRole('status').filter({ hasText: '已建立並發布' })).toBeVisible();

  const visitor = await browser.newContext();
  const anon = await visitor.newPage();
  await anon.goto('/search?q=測試歌手乙');
  await anon.getByRole('link', { name: /開啟譜/ }).click();
  await expect(anon.getByRole('heading', { name: '小城黃昏（虛構）' })).toBeVisible();
  await anon.getByLabel('移調夾格數').selectOption('2');
  await expect(anon.locator('.chord-sheet .chord-label').first()).toHaveText('C');
  await visitor.close();

  // Unknown rights can never be published to a wider audience.
  await page.goto('/admin/import');
  await page.getByLabel('ChordPro 內容').fill('{title: 權利不明的歌}\n[C]啦');
  await page.getByRole('button', { name: '預覽' }).click();
  await page.getByLabel('可見度').selectOption('public');
  await page.getByRole('button', { name: '建立' }).click();
  await expect(page.getByRole('status')).toContainText('content rights do not permit');
});
