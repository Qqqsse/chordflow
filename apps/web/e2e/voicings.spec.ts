import { expect, test } from '@playwright/test';

test.describe('chord diagrams', () => {
  test('shows validated diagrams for the shapes being played and lets the player choose', async ({
    page,
  }) => {
    await page.goto('/demo/arr_demo_001');
    const strip = page.getByTestId('voicing-strip');
    const cardC = strip.locator('[data-symbol="C"]');
    await expect(cardC.getByRole('img')).toHaveAttribute('data-voicing-id', 'v_x32010');
    await expect(cardC.getByRole('img')).toHaveAccessibleName(/C 指法 x32010/);

    await cardC.getByRole('button', { name: 'C 下一個指法' }).click();
    await expect(cardC.getByRole('img')).not.toHaveAttribute('data-voicing-id', 'v_x32010');
    // Choosing a fingering never changes the chart.
    await expect(page.locator('[data-chord-id="ch_verse_1"] .chord-label')).toHaveText('C');

    await expect(strip.locator('[data-symbol="G/B"]').getByRole('img')).toHaveAttribute(
      'data-voicing-id',
      'v_x20003',
    );
  });

  test('diagrams follow the capo shape', async ({ page }) => {
    await page.goto('/demo/arr_demo_001');
    await page.getByLabel('移調夾格數').selectOption('2');
    const strip = page.getByTestId('voicing-strip');
    await expect(strip.locator('[data-symbol="Bb"]')).toBeVisible();
    await expect(strip.locator('[data-symbol="C"]')).toHaveCount(0);
  });

  test('uses the arrangement default voicing when untransposed', async ({ page }) => {
    await page.goto('/demo/arr_demo_full_zh_001');
    const strip = page.getByTestId('voicing-strip');
    await expect(strip.locator('[data-symbol="Cadd9"]').getByRole('img')).toHaveAttribute(
      'data-voicing-id',
      'v_x32033',
    );
  });

  test('chords without a verified voicing show a transparent note', async ({ page }) => {
    await page.goto('/demo/arr_demo_full_zh_001');
    await expect(
      page.getByTestId('voicing-strip').locator('[data-symbol="B7/D#"]').getByRole('note'),
    ).toHaveText('沒有已驗證的指法');
  });

  test('the strip can be hidden', async ({ page }) => {
    await page.goto('/demo/arr_demo_001');
    await page.getByRole('button', { name: '指法圖' }).click();
    await expect(page.getByTestId('voicing-strip')).toHaveCount(0);
  });
});
