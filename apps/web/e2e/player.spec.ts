import { expect, test, type Page } from '@playwright/test';

const scrollY = (page: Page) => page.evaluate(() => window.scrollY);

test.describe('continuous autoscroll', () => {
  test.use({ viewport: { width: 390, height: 600 } });

  test('scrolls, and stops as soon as the player scrolls manually', async ({ page }) => {
    await page.goto('/demo/arr_demo_full_zh_001');
    await page.getByLabel('速度').fill('120');
    await page.getByRole('button', { name: '開始捲動' }).click();
    await expect(page.getByTestId('autoscroll-status')).toHaveText('自動捲動中');
    await expect.poll(() => scrollY(page), { timeout: 5_000 }).toBeGreaterThan(80);

    await page.mouse.move(200, 300);
    await page.mouse.wheel(0, -40);
    await expect(page.getByTestId('autoscroll-status')).toHaveText('偵測到手動捲動，已暫停');
    const stopped = await scrollY(page);
    await page.waitForTimeout(600);
    expect(Math.abs((await scrollY(page)) - stopped)).toBeLessThanOrEqual(1);
  });

  test('pause and resume with the button and the P key', async ({ page }) => {
    await page.goto('/demo/arr_demo_full_zh_001');
    await page.locator('body').press('p');
    await expect(page.getByTestId('autoscroll-status')).toHaveText('自動捲動中');
    await page.locator('body').press('p');
    await expect(page.getByTestId('autoscroll-status')).toHaveText('自動捲動已停止');
    await page.getByRole('button', { name: '開始捲動' }).click();
    await page.getByRole('button', { name: '暫停捲動' }).click();
    await expect(page.getByTestId('autoscroll-status')).toHaveText('自動捲動已停止');
  });

  test('respects prefers-reduced-motion by stepping instead of animating', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/demo/arr_demo_full_zh_001');
    await expect(page.getByTestId('autoscroll-status')).toContainText('減少動態：分段翻頁');
    await page.getByLabel('速度').fill('120');
    await page.getByRole('button', { name: '開始捲動' }).click();
    // No movement before the first step (≈ 0.8 × 600px / 120px/s = 4s), then one jump.
    await page.waitForTimeout(1_000);
    expect(await scrollY(page)).toBe(0);
    await expect.poll(() => scrollY(page), { timeout: 8_000 }).toBeGreaterThanOrEqual(400);
  });
});

test.describe('page mode', () => {
  test.use({ viewport: { width: 1024, height: 700 } });

  test('reads left to right with explicit page navigation', async ({ page }) => {
    await page.goto('/demo/arr_demo_full_zh_001');
    for (let i = 0; i < 4; i += 1) await page.getByRole('button', { name: '放大字級' }).click();
    await page.getByRole('button', { name: '分頁' }).click();
    const indicator = page.getByTestId('page-indicator');
    await expect(indicator).toHaveText(/第 1 \/ [2-9] 頁/);
    const total = Number((await indicator.textContent())?.match(/\/ (\d+)/)?.[1]);

    const visibleLines = () =>
      page.getByTestId('paged-viewport').evaluate((viewport) => {
        const box = viewport.getBoundingClientRect();
        return Array.from(viewport.querySelectorAll<HTMLElement>('[data-line-id]'))
          .map((el) => ({ id: el.dataset.lineId ?? '', r: el.getBoundingClientRect() }))
          .filter(({ r }) => r.width > 0 && r.left >= box.left - 1 && r.right <= box.right + 1)
          .sort((a, b) => a.r.left - b.r.left || a.r.top - b.r.top)
          .map(({ id }) => id);
      });
    const order = await page
      .getByTestId('paged-viewport')
      .evaluate((v) =>
        Array.from(v.querySelectorAll<HTMLElement>('[data-line-id]')).map(
          (el) => el.dataset.lineId ?? '',
        ),
      );

    const seen: string[] = [];
    for (let p = 1; p <= total; p += 1) {
      await expect(indicator).toHaveText(`第 ${p} / ${total} 頁`);
      seen.push(...(await visibleLines()));
      if (p < total) await page.getByRole('button', { name: '下一頁' }).click();
    }
    // Every line appears exactly once, in document order, across the pages.
    expect(seen).toEqual(order);

    await page.keyboard.press('ArrowLeft');
    await expect(indicator).toHaveText(`第 ${total - 1} / ${total} 頁`);
    await expect(page.getByRole('button', { name: '下一頁' })).toBeEnabled();
  });

  test('no horizontal page overflow in page mode on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/demo/arr_pd_songbie_001');
    await page.getByRole('button', { name: '分頁' }).click();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
