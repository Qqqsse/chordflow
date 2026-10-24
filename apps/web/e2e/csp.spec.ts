import { expect, test } from '@playwright/test';

/* The production build sends a strict same-origin CSP, and real pages run without violations. */

test('security headers are sent on pages and API routes', async ({ request }) => {
  for (const path of ['/', '/demo/arr_demo_full_zh_001', '/api/v1/health']) {
    const res = await request.get(path);
    const csp = res.headers()['content-security-policy'] ?? '';
    expect(csp, path).toContain("default-src 'self'");
    expect(csp, path).toContain("frame-ancestors 'none'");
    expect(csp, path).not.toContain('unsafe-eval');
    expect(res.headers()['x-content-type-options']).toBe('nosniff');
  }
});

test('viewer, diagrams, offline save and paged mode run without CSP violations', async ({
  page,
}) => {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text())) violations.push(message.text());
  });
  page.on('pageerror', (error) => violations.push(error.message));
  await page.goto('/demo/arr_demo_full_zh_001');
  await expect(page.getByTestId('chord-sheet')).toBeVisible();
  await page.getByRole('button', { name: '升半音' }).click();
  await page.getByRole('button', { name: '儲存離線' }).click();
  await expect(page.getByText(/已儲存離線/)).toBeVisible();
  await page.goto('/offline');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.goto('/search?q=示範');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(violations).toEqual([]);
});
