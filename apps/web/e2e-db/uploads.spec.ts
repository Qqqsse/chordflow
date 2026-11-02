import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { E2E_ADMIN, E2E_WORKER_TOKEN } from '../../../playwright.config';

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

  // Unique per attempt: a retried serial file runs again on the same database.
  const title = `晨光小路（自錄 ${String(test.info().retry)}）`;
  const rows = page.getByTestId('upload-row');
  const before = await rows.count();
  const form = page.getByRole('form', { name: '上傳音訊' });
  await form.getByLabel('音訊檔').setInputFiles({
    name: 'morning-path.wav',
    mimeType: 'audio/wav',
    buffer: syntheticWav(7),
  });
  await form.getByLabel('歌名').fill(title);
  // Without the declaration the browser refuses to submit.
  await form.getByRole('button', { name: '上傳' }).click();
  await expect(rows).toHaveCount(before);

  await form.getByRole('checkbox').check();
  await form.getByRole('button', { name: '上傳' }).click();
  await expect(page.getByRole('status')).toHaveText('已上傳。');
  const row = rows.filter({ hasText: title });
  await expect(row).toContainText('WAV');
  await expect(row).toContainText('保存到');

  // The API never reveals where the audio is stored.
  const listed = await page.request.get('/api/v1/audio-uploads');
  expect(listed.status()).toBe(200);
  expect(await listed.text()).not.toContain('storage');

  page.once('dialog', (dialog) => void dialog.accept());
  await row.getByRole('button', { name: `刪除「${title}」` }).click();
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

test('only the worker holding the lease downloads exactly the uploaded audio', async ({ page }) => {
  await login(page);
  const origin = new URL(page.url()).origin;
  const audio = syntheticWav(9);
  const uploaded = await page.request.post('/api/v1/audio-uploads', {
    headers: { origin },
    multipart: {
      file: { name: 'download-check.wav', mimeType: 'audio/wav', buffer: audio },
      title: '晨光小路（下載測試）',
      declarationVersion: 'audio-upload-v1',
      declarationAccepted: 'true',
    },
  });
  expect(uploaded.status()).toBe(201);
  const { upload } = (
    (await uploaded.json()) as {
      data: { upload: { sourceReferenceId: string; sha256: string } };
    }
  ).data;

  const submitted = await page.request.post('/api/v1/generation-jobs', {
    headers: { origin },
    data: {
      idempotencyKey: `e2e-audio-download-${String(test.info().retry)}`,
      input: { kind: 'source_reference', sourceReferenceId: upload.sourceReferenceId },
      target: {
        work: {
          title: '晨光小路（下載測試）',
          titleAliases: [],
          language: 'zh-TW',
          artistName: null,
        },
        name: 'AI 草稿',
        variant: 'original',
        visibility: 'private',
        rights: {
          lyrics: 'owner_original',
          chart: 'synthetic',
          audio: 'owner_original',
          attribution: null,
          notes: null,
        },
      },
    },
  });
  expect(submitted.status()).toBe(201);
  const jobId = ((await submitted.json()) as { data: { job: { id: string } } }).data.job.id;

  const worker = { authorization: `Bearer ${E2E_WORKER_TOKEN}` };
  // Earlier specs may have left queued jobs: claim until this one is leased.
  let job: { id: string; leaseToken: string } | null = null;
  for (let i = 0; i < 10 && job?.id !== jobId; i += 1) {
    const claim = await page.request.post('/api/v1/worker/jobs/claim', {
      headers: worker,
      data: {
        workerId: 'e2e-audio',
        workerVersion: '0.1.0',
        processors: ['mock'],
        leaseSeconds: 60,
      },
    });
    job = ((await claim.json()) as { data: { job: { id: string; leaseToken: string } | null } })
      .data.job;
    if (job === null) break;
  }
  if (job?.id !== jobId) throw new Error('the upload job was not claimed');

  const url = `/api/v1/worker/jobs/${jobId}/audio`;
  const lease = { 'x-worker-id': 'e2e-audio', 'x-lease-token': job.leaseToken };
  expect((await page.request.get(url, { headers: lease })).status()).toBe(401);
  const stranger = await page.request.get(url, {
    headers: { ...worker, ...lease, 'x-worker-id': 'someone-else' },
  });
  expect(stranger.status()).toBe(409);

  const download = await page.request.get(url, { headers: { ...worker, ...lease } });
  expect(download.status()).toBe(200);
  const body = await download.body();
  expect(Buffer.compare(body, audio)).toBe(0);
  expect(download.headers()['x-content-sha256']).toBe(upload.sha256);
  expect(createHash('sha256').update(body).digest('hex')).toBe(upload.sha256);
  expect(download.headers()['x-audio-format']).toBe('wav');
  expect(download.headers()['cache-control']).toBe('no-store');

  // Release the job so nothing else picks it up.
  const failed = await page.request.post(`/api/v1/worker/jobs/${jobId}/fail`, {
    headers: worker,
    data: {
      workerId: 'e2e-audio',
      leaseToken: job.leaseToken,
      error: { code: 'MODEL_UNAVAILABLE', message: 'e2e check only', retryable: false },
    },
  });
  expect(failed.status()).toBe(200);
});
