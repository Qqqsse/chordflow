import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { E2E_ADMIN, E2E_WORKER_TOKEN } from '../../../playwright.config';

/*
 * SPEC §16 M7 acceptance, end to end and CPU-only: admin "generate demo
 * chart" → queued (no worker online) → the real Python worker claims it →
 * progress → draft → review (edit as a new revision) → publish.
 */

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const WORKER_DIR = path.join(REPO, 'services/ai-worker');
const PYTHON =
  process.env.WORKER_PYTHON ??
  (existsSync(path.join(WORKER_DIR, '.venv/bin/python'))
    ? path.join(WORKER_DIR, '.venv/bin/python')
    : 'python3');

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(E2E_ADMIN.email);
  await page.getByLabel('密碼').fill(E2E_ADMIN.password);
  await page.getByRole('button', { name: '登入' }).click();
  await expect(page.getByTestId('account-name')).toBeVisible();
}

/** Runs `chordflow-worker run --drain` against the database-mode server. */
function runWorker(
  baseURL: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, ['-m', 'chordflow_worker', 'run', '--drain'], {
      cwd: WORKER_DIR,
      env: {
        NODE_ENV: 'test',
        PATH: process.env.PATH ?? '',
        PYTHONPATH: path.join(WORKER_DIR, 'src'),
        WORKER_API_BASE_URL: baseURL,
        WORKER_TOKEN: E2E_WORKER_TOKEN,
        WORKER_ID: 'e2e-cpu-mock',
        WORKER_ARTIFACT_DIR: mkdtempSync(path.join(tmpdir(), 'chordflow-artifacts-')),
        WORKER_STAGE_DELAY_SECONDS: '0.4',
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

test.describe.configure({ mode: 'serial' });

test('worker API refuses requests without the worker credential', async ({ request }) => {
  const claim = { workerId: 'x', workerVersion: '0.1.0', processors: ['mock'] };
  expect((await request.post('/api/v1/worker/jobs/claim', { data: claim })).status()).toBe(401);
  const wrong = await request.post('/api/v1/worker/jobs/claim', {
    data: claim,
    headers: { authorization: 'Bearer not-the-worker-token-0123456789abcdef' },
  });
  expect(wrong.status()).toBe(401);
  // A user session is not a worker credential either; and submissions need the same origin.
  const anonymous = await request.post('/api/v1/generation-jobs', { data: {} });
  expect(anonymous.status()).toBe(403);
});

test('generate → queued → worker → review → edit → publish', async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  await login(page);
  await page.goto('/admin/generate');
  await page.getByRole('button', { name: '填入自創範例歌詞' }).click();
  await page.getByLabel('調性').selectOption('C');
  await page.getByLabel('加上假審查器的建議（測試用，不呼叫任何付費服務）').check();
  await page.getByRole('button', { name: '產生草稿' }).click();
  await expect(page.getByRole('status')).toHaveText('已建立任務。');

  // No worker has reported yet: the status says so honestly.
  const row = page.getByRole('list', { name: '生成任務' }).getByRole('listitem').first();
  await expect(row.getByTestId('job-status')).toHaveAttribute('data-status', 'waiting_for_worker');

  // Submitting the same request again reuses the job instead of duplicating work.
  await page.getByRole('button', { name: '產生草稿' }).click();
  await expect(page.getByRole('status')).toHaveText('已有相同的任務，沿用既有任務。');
  await expect(page.getByRole('list', { name: '生成任務' }).getByRole('listitem')).toHaveCount(1);

  const worker = runWorker(baseURL ?? '');
  await expect(row.getByTestId('job-status')).toHaveAttribute('data-status', 'needs_review', {
    timeout: 60_000,
  });
  const finished = await worker;
  expect(finished.code, finished.stderr).toBe(0);
  expect(JSON.parse(finished.stdout.trim().split('\n').at(-1) ?? '{}')).toEqual({
    status: 'ok',
    processed: 1,
  });
  expect(finished.stderr).not.toContain(E2E_WORKER_TOKEN);
  expect(finished.stderr).toContain('"event": "stage"');

  await row.getByRole('link', { name: '審查草稿' }).click();
  await expect(page.getByTestId('synthetic-banner')).toBeVisible();
  const spans = page.getByTestId('quality-spans');
  await expect(spans).toContainText('非順階和弦');
  await expect(spans).toContainText('D 不在 C 調的順階和弦內');
  await expect(page.getByTestId('suggestions')).toContainText('Dm');
  await page.getByText('處理階段與產出').click();
  await expect(page.getByTestId('artifacts').getByRole('listitem')).toHaveCount(4);
  await expect(page.getByRole('list', { name: '狀態紀錄' })).toContainText('running → draft_ready');

  // The flagged chord is highlighted on the sheet.
  const flagged = page.locator('.review-sheet .chord-label', { hasText: /^D$/ }).first();
  await expect(flagged).toHaveCSS('outline-style', 'dashed');

  // Accept the suggestion by editing: a new human revision derived from the draft.
  await page.getByRole('button', { name: '以 ChordPro 修改' }).click();
  const editor = page.getByLabel('修改內容（ChordPro）');
  const source = await editor.inputValue();
  expect(source).toContain('[D]');
  await editor.fill(source.replace('[D]', '[Dm]'));
  await page.getByRole('button', { name: '儲存為新修訂' }).click();
  await expect(page.getByRole('status')).toContainText('已儲存為第 2 版修訂');
  await page.getByRole('button', { name: '發布第 2 版修訂' }).click();
  await expect(page.getByRole('status')).toHaveText('已發布。');
  await expect(page.getByTestId('job-status')).toHaveAttribute('data-status', 'completed');

  await page.getByRole('link', { name: '開啟已發布的譜' }).click();
  const sheet = page.getByTestId('chord-sheet');
  await expect(sheet).toContainText('清晨的風');
  await expect(sheet.locator('.chord-label', { hasText: /^Dm$/ }).first()).toBeVisible();
  await expect(sheet.locator('.chord-label', { hasText: /^D$/ })).toHaveCount(0);
});

test('a cancelled job can be retried as a new job; worker status is shown', async ({ page }) => {
  await login(page);
  await page.goto('/admin/generate');
  await expect(page.getByTestId('worker-status')).toContainText('worker');
  await page.getByRole('button', { name: '填入自創範例歌詞' }).click();
  await page.getByLabel('歌名').fill('重試測試曲（自創）');
  await page.getByRole('button', { name: '產生草稿' }).click();
  await expect(page.getByRole('status').first()).toHaveText('已建立任務。');

  const jobs = page.getByRole('list', { name: '生成任務' });
  const original = jobs.getByRole('listitem').filter({ hasText: '重試測試曲' }).first();
  await original.getByRole('button', { name: '取消' }).click();
  await expect(original.getByTestId('job-status')).toHaveAttribute('data-status', 'cancelled');

  await original.getByRole('button', { name: '重試' }).click();
  const retried = jobs.getByRole('listitem').filter({ hasText: '（重試）' });
  await expect(retried).toHaveCount(1);
  await expect(retried.getByTestId('job-status')).toHaveAttribute(
    'data-status',
    /^(queued|waiting_for_worker)$/,
  );
  // The original stays cancelled; the retry is a separate job.
  await expect(
    jobs.getByRole('listitem').filter({ hasText: '重試測試曲' }).getByTestId('job-status'),
  ).toHaveCount(2);
});
