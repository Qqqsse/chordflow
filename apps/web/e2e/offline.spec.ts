import { expect, test, type Page } from '@playwright/test';

async function waitForServiceWorker(page: Page) {
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return registration.active?.state;
  });
}

async function putRawRecord(page: Page, record: Record<string, unknown>) {
  await page.evaluate(
    (value) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('chordflow-offline', 1);
        open.onupgradeneeded = () => {
          open.result
            .createObjectStore('charts', { keyPath: 'key' })
            .createIndex('namespace', 'namespace');
        };
        open.onsuccess = () => {
          const tx = open.result.transaction('charts', 'readwrite');
          tx.objectStore('charts').put(value);
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => {
            reject(new Error('put failed'));
          };
        };
      }),
    record,
  );
}

test.describe('offline charts', () => {
  test('a saved chart stays usable after the network is gone', async ({ page, context }) => {
    await page.goto('/demo/arr_pd_songbie_001');
    await page.getByRole('button', { name: '儲存離線' }).click();
    await expect(page.getByTestId('save-offline')).toContainText('已儲存離線');
    await waitForServiceWorker(page);

    await page.goto('/offline');
    await expect(page.getByTestId('offline-count')).toHaveText('共 1 份離線譜');

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('link', { name: '送別' })).toBeVisible();
    await page.getByRole('link', { name: '送別' }).click();
    await expect(page.getByRole('heading', { name: '送別' })).toBeVisible();
    await expect(page.getByTestId('offline-badge')).toContainText('離線版本');

    // Theory, capo and diagrams work entirely client-side.
    await page.getByRole('button', { name: '升半音' }).click();
    await page.getByRole('button', { name: '升半音' }).click();
    await expect(page.locator('[data-chord-id="sb_c10"] .chord-label')).toHaveText('D');
    await expect(
      page.getByTestId('voicing-strip').locator('[data-symbol="D"]').getByRole('img'),
    ).toBeVisible();

    // Pages that need the network say so instead of failing silently.
    await page.goto('/demo').catch(() => undefined);
    await expect(page.getByRole('heading', { name: '目前離線' })).toBeVisible();
    await context.setOffline(false);
  });

  test('saving again updates the stored copy', async ({ page }) => {
    await page.goto('/demo/arr_demo_001');
    await page.getByRole('button', { name: '儲存離線' }).click();
    await expect(page.getByRole('button', { name: '更新離線版本' })).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('save-offline')).toContainText('已儲存離線');
  });

  test('an incompatible cached chart is rejected with a recoverable notice', async ({ page }) => {
    await page.goto('/offline');
    await putRawRecord(page, {
      key: 'guest:arr_future',
      recordVersion: 1,
      namespace: 'guest',
      title: '未來格式的譜',
      document: { schemaVersion: '9.0.0', title: '未來格式的譜' },
    });
    await page.reload();
    const notice = page.getByRole('alert').filter({ hasText: '未來格式的譜' });
    await expect(notice).toContainText('和弦譜格式已不相容');

    await page.goto('/offline/view?id=arr_future');
    // (Next.js also renders an empty route-announcer alert, so filter by text.)
    await expect(page.getByRole('alert').filter({ hasText: '無法安全開啟' })).toBeVisible();
    await expect(page.getByTestId('chord-sheet')).toHaveCount(0);

    await page.goto('/offline');
    await page
      .getByRole('alert')
      .filter({ hasText: '未來格式的譜' })
      .getByRole('button', { name: '移除' })
      .click();
    await expect(page.getByRole('alert').filter({ hasText: '未來格式的譜' })).toHaveCount(0);
  });

  test('remove and clear all', async ({ page }) => {
    for (const id of ['arr_demo_001', 'arr_pd_amazing_grace_001']) {
      await page.goto(`/demo/${id}`);
      await page.getByRole('button', { name: '儲存離線' }).click();
      await expect(page.getByTestId('save-offline')).toContainText('已儲存離線');
    }
    await page.goto('/offline');
    await expect(page.getByTestId('offline-count')).toHaveText('共 2 份離線譜');
    await page.getByRole('button', { name: '移除 Amazing Grace' }).click();
    await expect(page.getByTestId('offline-count')).toHaveText('共 1 份離線譜');
    await page.getByRole('button', { name: '全部清除' }).click();
    await page.getByRole('button', { name: '確定清除全部？' }).click();
    await expect(page.getByTestId('offline-count')).toHaveText('共 0 份離線譜');
  });
});
