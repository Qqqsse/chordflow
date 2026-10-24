import { expect, test, type Locator, type Page } from '@playwright/test';

const chord = (page: Page, id: string) => page.locator(`[data-chord-id="${id}"] .chord-label`);

test.describe('chart viewer controls', () => {
  test('transposes a slash chord, applies capo, toggles numbering and keeps the chart intact', async ({
    page,
  }) => {
    await page.goto('/demo/arr_demo_001');
    const slash = chord(page, 'ch_verse_2');
    await expect(slash).toHaveText('G/B');

    await page.getByRole('button', { name: '升半音' }).click();
    await page.getByRole('button', { name: '升半音' }).click();
    await expect(page.getByTestId('transpose-value')).toHaveText('+2');
    await expect(page.getByTestId('key-sounding')).toHaveText('D');
    await expect(slash).toHaveText('A/C#');

    await page.getByLabel('移調夾格數').selectOption('2');
    await expect(page.getByTestId('key-shape')).toHaveText('C');
    await expect(page.getByTestId('key-sounding')).toHaveText('D');
    await expect(slash).toHaveText('G/B');

    await page.getByText('進階設定').click();
    await page.getByRole('button', { name: '實際音' }).click();
    await expect(slash).toHaveText('A/C#');

    await page.getByRole('button', { name: '羅馬級數' }).click();
    await expect(slash).toHaveText('V/7');
    await expect(chord(page, 'ch_verse_1')).toHaveText('I');
    await page.getByRole('button', { name: 'Nashville' }).click();
    await expect(slash).toHaveText('5/7');

    await page.getByRole('button', { name: '全部重設' }).click();
    await expect(slash).toHaveText('G/B');
    await expect(page.getByTestId('key-sounding')).toHaveText('C');

    // The canonical chart served by the app is unchanged by any of the above.
    await page.reload();
    await expect(chord(page, 'ch_verse_2')).toHaveText('G/B');
    await expect(page.getByTestId('key-concert')).toHaveText('C');
  });

  test('keep-shape capo mode keeps fingerings and moves the sounding key', async ({ page }) => {
    await page.goto('/demo/arr_demo_001');
    await page.getByText('進階設定').click();
    await page.getByRole('button', { name: '保持按法' }).click();
    await page.getByLabel('移調夾格數').selectOption('3');
    await expect(chord(page, 'ch_verse_2')).toHaveText('G/B');
    await expect(page.getByTestId('key-sounding')).toHaveText('Eb');
    await expect(page.getByTestId('transpose-value')).toHaveText('+3');
  });

  test('keyboard shortcuts transpose, but not while a field has focus', async ({ page }) => {
    await page.goto('/demo/arr_demo_001');
    await page.locator('body').press('+');
    await page.locator('body').press('+');
    await expect(page.getByTestId('transpose-value')).toHaveText('+2');
    await page.locator('body').press('-');
    await expect(page.getByTestId('transpose-value')).toHaveText('+1');
    await page.locator('body').press('0');
    await expect(page.getByTestId('transpose-value')).toHaveText('0');

    await page.getByLabel('移調夾格數').focus();
    await page.keyboard.press('+');
    await expect(page.getByTestId('transpose-value')).toHaveText('0');
  });

  test('controls are reachable by keyboard', async ({ page }) => {
    await page.goto('/demo/arr_demo_001');
    const up = page.getByRole('button', { name: '升半音' });
    await up.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('transpose-value')).toHaveText('+1');
    await expect(page.getByRole('button', { name: '和弦' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('font size buttons scale the sheet', async ({ page }) => {
    await page.goto('/demo/arr_demo_001');
    const sheet = page.getByTestId('chord-sheet');
    const before = await sheet.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    await page.getByRole('button', { name: '放大字級' }).click();
    const after = await sheet.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(after).toBeGreaterThan(before);
  });
});

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function boxes(locator: Locator): Promise<Box[]> {
  return locator.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }),
  );
}

function overlaps(a: Box, b: Box): boolean {
  const eps = 0.5;
  return (
    a.x + eps < b.x + b.width &&
    b.x + eps < a.x + a.width &&
    a.y + eps < b.y + b.height &&
    b.y + eps < a.y + a.height
  );
}

async function assertLayout(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'no horizontal page overflow').toBeLessThanOrEqual(0);

  const labels = await boxes(page.locator('.chord-sheet .chord-label'));
  expect(labels.length).toBeGreaterThan(0);
  for (let i = 0; i < labels.length; i += 1) {
    for (let j = i + 1; j < labels.length; j += 1) {
      const a = labels[i];
      const b = labels[j];
      if (a && b) expect(overlaps(a, b), `chord labels ${i} and ${j} overlap`).toBe(false);
    }
  }

  // Each anchored chord sits directly above the start of its anchor text.
  const pairs = await page.locator('.chord-sheet .anchor').evaluateAll((els) =>
    els.map((el) => {
      const label = el.querySelector('.chord-label')?.getBoundingClientRect();
      const text = el.querySelector('.lyric')?.getBoundingClientRect();
      const sheet = el.closest('.chord-sheet')?.getBoundingClientRect();
      return label && text && sheet
        ? {
            lx: label.x,
            lb: label.bottom,
            lr: label.right,
            tx: text.x,
            tt: text.top,
            sr: sheet.right,
          }
        : null;
    }),
  );
  for (const p of pairs) {
    if (p === null) continue;
    expect(Math.abs(p.lx - p.tx), 'chord starts at its anchor text').toBeLessThanOrEqual(1);
    expect(p.lb, 'chord is above its anchor text').toBeLessThanOrEqual(p.tt + 1);
    expect(p.lr, 'chord is not clipped by the sheet').toBeLessThanOrEqual(p.sr + 1);
  }

  // Lyric text on one visual row shares a baseline whether or not it carries a chord.
  const rows = await page.locator('.chord-sheet .sheet-line').evaluateAll((lines) =>
    lines.map((line) => {
      const bottoms = new Map<number, number[]>();
      for (const lyric of Array.from(line.querySelectorAll('.lyric'))) {
        for (const rect of Array.from(lyric.getClientRects())) {
          if (rect.width === 0) continue;
          const key = Math.round(rect.bottom / 4);
          bottoms.set(key, [...(bottoms.get(key) ?? []), rect.bottom]);
        }
      }
      return [...bottoms.values()].map((v) => Math.max(...v) - Math.min(...v));
    }),
  );
  for (const spreads of rows) {
    for (const spread of spreads)
      expect(spread, 'lyrics in a row share a baseline').toBeLessThanOrEqual(1.5);
  }
}

const LAYOUT_CASES = [
  {
    name: '320px portrait, Chinese song',
    path: '/demo/arr_demo_full_zh_001',
    width: 320,
    height: 640,
  },
  { name: '320px portrait, English song', path: '/demo/arr_demo_en_001', width: 320, height: 640 },
  { name: '320px portrait, 送別', path: '/demo/arr_pd_songbie_001', width: 320, height: 640 },
  { name: 'phone, Amazing Grace', path: '/demo/arr_pd_amazing_grace_001', width: 375, height: 812 },
  {
    name: 'tablet landscape, Chinese song',
    path: '/demo/arr_demo_full_zh_001',
    width: 1024,
    height: 768,
  },
  { name: 'desktop, English song', path: '/demo/arr_demo_en_001', width: 1440, height: 900 },
] as const;

test.describe('chord sheet layout', () => {
  for (const c of LAYOUT_CASES) {
    test(`${c.name}: aligned, no overlap, no overflow`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: c.width, height: c.height });
      await page.goto(c.path);
      await assertLayout(page);
      for (let i = 0; i < 6; i += 1) await page.getByRole('button', { name: '放大字級' }).click();
      await assertLayout(page);
      await page.getByRole('button', { name: '羅馬級數' }).click();
      await assertLayout(page);
      await testInfo.attach('screenshot', {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      });
    });
  }

  test('dark mode renders with readable chords', async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/demo/arr_pd_songbie_001');
    const color = await chord(page, 'sb_c10').evaluate((el) => getComputedStyle(el).color);
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(color).not.toBe(bg);
    await assertLayout(page);
    await testInfo.attach('dark', { body: await page.screenshot(), contentType: 'image/png' });
  });
});
