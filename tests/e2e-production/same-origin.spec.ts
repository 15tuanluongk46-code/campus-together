import { test, expect } from '@playwright/test';
test('built production loads split bundles and creates a real room on one origin', async ({ page }, info) => {
  const errors: string[] = [], requests: string[] = [];
  page.on('pageerror', error => errors.push(error.message)); page.on('request', r => requests.push(r.url()));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.addInitScript(() => localStorage.setItem('campus-settings', JSON.stringify({ quality: 'low', music: 0, effects: 0 })));
  await page.goto('/'); await page.waitForLoadState('networkidle');
  await expect(page.getByRole('button', { name: /Tạo phòng cùng bạn/ })).toBeEnabled();
  await page.getByLabel('Bạn tên là gì?').fill('Khách production'); await page.getByRole('button', { name: /Tạo phòng cùng bạn/ }).click();
  await expect(page.getByRole('heading', { name: 'Nhóm của chúng mình' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('production-lobby.png') });
  expect(requests.filter(url => /^https?:/.test(url)).every(url => new URL(url).origin === new URL(page.url()).origin)).toBe(true);
  await page.getByRole('button', { name: 'Rời phòng' }).click(); await expect(page.getByRole('heading', { name: /Hẹn nhau/ })).toBeVisible();
  expect(errors).toEqual([]);
});
