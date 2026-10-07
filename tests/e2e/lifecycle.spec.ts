import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { enter, observe } from './helpers.js';
import { TestClient, browserEndpoint } from '../helpers/client.js';
test('asset failure, cancelled slow matchmaking and reconnect on the real websocket path', async ({ page }, info) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 1100, height: 720 });
  await page.addInitScript(() => localStorage.setItem('campus-settings', JSON.stringify({ quality: 'low', music: 0, effects: 0 })));
  const observer = observe(page);
  await page.route('**/assets/student-0.glb', route => route.fulfill({ status: 503, body: 'Asset intentionally unavailable in test' }));
  await page.goto('/'); await expect(page.getByRole('heading', { name: 'Sân trường chưa sẵn sàng' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('14-load-error.png') });
  await page.unroute('**/assets/student-0.glb'); await page.getByRole('button', { name: 'Tải lại tài nguyên' }).click();
  await expect(page.getByRole('button', { name: /Tạo phòng cùng bạn/ })).toBeEnabled({ timeout: 60000 });
  await page.route('**/matchmake/create/campus', async route => { await new Promise(r => setTimeout(r, 1700)); await route.continue(); });
  await page.getByLabel('Bạn tên là gì?').fill('An'); await page.getByRole('button', { name: /Tạo phòng cùng bạn/ }).click(); await page.getByRole('button', { name: 'Hủy kết nối' }).click();
  await page.waitForTimeout(2600); await expect(page.getByRole('heading', { name: /Hẹn nhau/ })).toBeVisible();
  await page.unroute('**/matchmake/create/campus');
  await page.addInitScript(() => {
    const Native = window.WebSocket;
    const sockets: WebSocket[] = [];
    Object.assign(window, { testSockets: sockets });
    window.WebSocket = class extends Native { constructor(url: string | URL, protocols?: string | string[]) { super(url, protocols); sockets.push(this); } };
  });
  await enter(page, 'An');
  const code = (await page.locator('#invite-code').innerText()).trim();
  const peer = await TestClient.join(browserEndpoint, code, 'Bình');
  try {
    await page.getByRole('button', { name: 'Mình sẵn sàng' }).click(); await peer.act({ type: 'ready', ready: true });
    await page.getByRole('button', { name: 'Cùng vào sân trường' }).click(); await page.getByRole('button', { name: 'Vào sân · Bật điều khiển chuột' }).click();
    await page.keyboard.press('KeyS', { delay: 200 });
    const id = observer.welcome!.playerId;
    await page.evaluate(() => {
      const sockets = (window as unknown as { testSockets: WebSocket[] }).testSockets;
      const room = sockets.find(s => /\/[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}\?/.test(s.url));
      if (!room) throw new Error('No real room socket captured'); room.close(4010, 'test link interruption');
    });
    await expect(page.locator('#network')).toBeVisible(); await page.screenshot({ path: info.outputPath('15-reconnect.png') });
    await expect(page.locator('#network')).toBeHidden({ timeout: 20000 });
    expect(observer.welcome!.playerId).toBe(id); await expect(page.getByRole('button', { name: 'Tiếp tục · Bật điều khiển chuột' })).toBeEnabled();
    await page.getByRole('button', { name: 'Tiếp tục · Bật điều khiển chuột' }).click();
    const before = observer.snapshot!.players.find(p => p.id === id)!.ackSeq;
    await page.keyboard.press('KeyS', { delay: 200 });
    await expect.poll(() => observer.snapshot!.players.find(p => p.id === id)!.ackSeq).toBeGreaterThan(before);
    await page.evaluate(() => document.exitPointerLock()); await page.getByRole('button', { name: 'Rời phòng', exact: true }).click();
    await page.getByRole('button', { name: 'Rời lượt chơi', exact: true }).click();
    await expect(page.getByRole('heading', { name: /Hẹn nhau/ })).toBeVisible();
    await info.attach('fault-path', { body: JSON.stringify({ errors: observer.errors, warnings: observer.warnings, idPreserved: observer.welcome!.playerId === id }, null, 2), contentType: 'application/json' });
    await writeFile(info.outputPath('fault-path.json'), JSON.stringify({ errors: observer.errors, warnings: observer.warnings, idPreserved: observer.welcome!.playerId === id, expectedFailures: ['503 student-0.glb', 'cancelled asset fetches'] }, null, 2));
  } finally { await peer.room.leave(); }
});
