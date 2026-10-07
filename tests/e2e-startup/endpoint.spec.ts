import { test, expect } from '@playwright/test';
test('invalid deployment endpoint gives a Vietnamese startup error instead of loading forever', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Chưa mở được sân trường' })).toBeVisible();
  await expect(page.locator('p')).toContainText('VITE_SERVER_URL');
  await expect(page.getByRole('button', { name: 'Tải lại', exact: true })).toBeEnabled();
  expect(errors).toEqual([]); await page.screenshot({ path: info.outputPath('invalid-endpoint.png') });
});
