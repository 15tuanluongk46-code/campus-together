import { test, expect } from '@playwright/test';
import { enter, observe } from './helpers.js';
import { TestClient, browserEndpoint } from '../helpers/client.js';
import { snapshot, player } from '../client/fixtures.js';

test('modal contains keyboard/programmatic focus, restores opener, survives lobby/start/settings transitions', async ({ page }) => {
  const view = observe(page);
  await enter(page, 'Focus');
  const code = await page.locator('#invite-code').innerText();
  const peer = await TestClient.join(browserEndpoint, code);
  try {
    const opener = page.getByRole('button', { name: '☷ Cài đặt', exact: true });
    await opener.click();
    await page.evaluate(() => document.querySelector<HTMLElement>('#screen [data-action="leave"]')!.focus());
    expect(await page.evaluate(() => !!document.activeElement?.closest('#modal'))).toBe(true);
    await page.getByRole('button', { name: 'Xong rồi' }).focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Đóng cài đặt' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('button', { name: 'Xong rồi' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(opener).toBeFocused();
    await peer.act({ type: 'ready', ready: true });
    await page.getByRole('button', { name: 'Mình sẵn sàng' }).click();
    await page.getByRole('button', { name: 'Cùng vào sân trường' }).click();
    await expect(page.getByRole('button', { name: 'Vào sân · Bật điều khiển chuột' })).toBeFocused();
    await page.getByRole('button', { name: 'Cài đặt', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Tiếp tục · Bật điều khiển chuột' })).toBeFocused();
    await page.getByRole('button', { name: 'Tiếp tục · Bật điều khiển chuột' }).click();
    await expect.poll(() => page.evaluate(() => !!document.pointerLockElement)).toBe(true);
    expect(await page.locator('#hud').evaluate(e => (e as HTMLElement).inert)).toBe(false);
    await page.evaluate(() => document.exitPointerLock());
    await page.getByRole('button', { name: 'Rời phòng', exact: true }).click();
    await page.getByRole('button', { name: 'Rời lượt chơi', exact: true }).click();
    await expect(page.getByRole('button', { name: /Tạo phòng cùng bạn/ })).toBeEnabled();
    expect(await page.locator('#screen').evaluate(e => (e as HTMLElement).inert)).toBe(false);
    expect(view.errors).toEqual([]);
  } finally { await peer.room.leave(); }
});

test('UI boundary: loading completion preserves settings; remote start/results/replay replace modal and restore usable focus', async ({ page }) => {
  await page.goto('/'); await page.waitForLoadState('networkidle');
  await expect(page.getByRole('button', { name: /Tạo phòng cùng bạn/ })).toBeEnabled({ timeout: 60000 });
  const lobby = snapshot({ phase: 'lobby', players: [player({ ready: true })] });
  await page.evaluate(async s => {
    window.dispatchEvent(new Event('pagehide'));
    const path = '/src/ui.ts'; const { UI } = await import(/* @vite-ignore */ path);
    const noop = () => {};
    const ui = new UI(document.querySelector('#app'), { quality: 'high', music: .3, effects: .7, sensitivity: 1, reducedMotion: false }, '', { connect: noop, cancel: noop, ready: noop, start: noop, replay: noop, leave: noop, play: noop, pause: noop, settings: noop, ping: noop, audio: noop });
    Object.assign(window, { isolatedUI: ui }); ui.update(s, 'me'); ui.connection('online', '');
  }, lobby);
  await page.getByRole('button', { name: '☷ Cài đặt', exact: true }).click();
  await page.evaluate(() => (window as any).isolatedUI.loaded());
  await expect(page.getByRole('heading', { name: 'Vừa ý bạn' })).toBeVisible();
  await page.evaluate(s => (window as any).isolatedUI.update(s, 'me'), snapshot());
  await expect(page.getByRole('button', { name: 'Vào sân · Bật điều khiển chuột' })).toBeFocused();
  await page.getByRole('button', { name: 'Cài đặt', exact: true }).click();
  await page.evaluate(s => (window as any).isolatedUI.update(s, 'me'), snapshot({ phase: 'results', result: 'success', score: 1200 }));
  await expect(page.getByRole('button', { name: 'Hẹn thêm một lượt nữa' })).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.evaluate(s => (window as any).isolatedUI.update(s, 'me'), { ...lobby, roundId: 2 });
  await page.getByRole('button', { name: '☷ Cài đặt', exact: true }).click();
  await page.keyboard.press('Escape'); await expect(page.getByRole('button', { name: '☷ Cài đặt', exact: true })).toBeFocused();
  await page.evaluate(() => (window as any).isolatedUI.dispose());
});

test('unexpected animation is rejected at asset load with actionable UI', async ({ page }) => {
  await page.route('**/assets/manifest.json', async route => {
    const response = await route.fetch(); const manifest = await response.json();
    delete manifest.animations.walk; // shipped GLB now has an unsupported extra clip
    await route.fulfill({ response, json: manifest });
  });
  await page.goto('/');
  await expect(page.getByRole('alertdialog')).toContainText('chuyển động');
  await expect(page.getByRole('button', { name: 'Tải lại tài nguyên' })).toBeFocused();
});
