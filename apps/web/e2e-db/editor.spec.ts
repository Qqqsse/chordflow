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

test('admins see an append-only rights history for an arrangement', async ({ page }) => {
  await login(page, E2E_ADMIN.email, E2E_ADMIN.password);
  const origin = { origin: new URL(page.url()).origin };
  const rights = {
    lyrics: 'owner_original',
    chart: 'owner_original',
    audio: 'unknown',
    attribution: '稽核測試（自創）',
    notes: null,
  };
  const created = await page.request.post('/api/v1/arrangements', {
    data: {
      work: { title: '稽核頁測試曲', titleAliases: [], language: 'zh-TW', artistName: null },
      name: '原調',
      visibility: 'private',
      rights,
    },
    headers: origin,
  });
  expect(created.status()).toBe(201);
  const { arrangementId } = ((await created.json()) as { data: { arrangementId: string } }).data;
  const patched = await page.request.patch(`/api/v1/arrangements/${arrangementId}`, {
    data: { visibility: 'shared', rights },
    headers: origin,
  });
  expect(patched.status()).toBe(200);

  await page.goto(`/admin/arrangements/${arrangementId}/audit`);
  const log = page.getByTestId('audit-log');
  await expect(log.getByRole('listitem').filter({ hasText: '・' })).toHaveCount(2);
  await expect(log).toContainText('建立');
  await expect(log).toContainText('可見度：私人 → 會員可見');
  await expect(log).toContainText(E2E_ADMIN.name);

  // Members cannot read it.
  const anonymous = await page.context().browser()?.newContext();
  const response = await anonymous?.request.get(
    `${new URL(page.url()).origin}/api/v1/arrangements/${arrangementId}/audit`,
  );
  expect(response?.status()).toBe(401);
  await anonymous?.close();
});

test('admins move, rename and add chords in the editor and publish a new revision', async ({
  page,
}) => {
  await login(page, E2E_ADMIN.email, E2E_ADMIN.password);
  const origin = { origin: new URL(page.url()).origin };
  const created = await page.request.post('/api/v1/arrangements', {
    data: {
      work: {
        title: '編輯器測試曲（自創）',
        titleAliases: [],
        language: 'zh-TW',
        artistName: null,
      },
      name: '原調',
      visibility: 'private',
      rights: {
        lyrics: 'owner_original',
        chart: 'owner_original',
        audio: 'unknown',
        attribution: null,
        notes: null,
      },
    },
    headers: origin,
  });
  const { arrangementId } = ((await created.json()) as { data: { arrangementId: string } }).data;
  const revision = await page.request.post(`/api/v1/arrangements/${arrangementId}/revisions`, {
    data: {
      chordpro: { source: '{title: 編輯器測試曲（自創）}\n{key: C}\n\n[C]晨光照進小窗[G]口\n' },
      expectedLatestRevision: null,
    },
    headers: origin,
  });
  expect(revision.status()).toBe(201);

  await page.goto(`/admin/arrangements/${arrangementId}/edit`);
  const line = page.getByTestId('editor-line').first();
  // Move G from 「口」 to 「小」.
  await line.getByRole('button', { name: 'G', exact: true }).click();
  await line.getByRole('button', { name: '第 1 行 「小」前' }).click();
  // Rename C to Cmaj7, and refuse a nonsense name.
  await line.getByRole('button', { name: 'C', exact: true }).click();
  await page.getByLabel(/改為/).fill('H<b>');
  await page.getByRole('button', { name: '改名' }).click();
  await expect(page.getByRole('alert').filter({ hasText: '無法辨識的和弦名稱' })).toBeVisible();
  await page.getByLabel(/改為/).fill('Cmaj7');
  await page.getByRole('button', { name: '改名' }).click();
  // Add Am before 「照」.
  await line.getByRole('button', { name: 'Cmaj7', exact: true }).click(); // deselect
  await page.getByLabel('新增和弦').fill('Am');
  await line.getByRole('button', { name: '第 1 行 「照」前' }).click();

  const preview = page.getByTestId('chord-sheet');
  await expect(preview.locator('.chord-label')).toHaveText(['Cmaj7', 'Am', 'G']);
  await page.getByRole('button', { name: '儲存為新修訂' }).click();
  await expect(page.getByRole('status')).toHaveText('已儲存為第 2 版（草稿，尚未發布）。');
  await page.getByRole('button', { name: '發布第 2 版' }).click();
  await expect(page.getByRole('status')).toHaveText('已發布第 2 版。');

  await page.goto(`/charts/${arrangementId}`);
  await expect(page.getByTestId('chord-sheet').locator('.chord-label')).toHaveText([
    'Cmaj7',
    'Am',
    'G',
  ]);
});
