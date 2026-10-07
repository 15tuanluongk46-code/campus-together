import { test, expect } from '@playwright/test';
import { enter, observe } from './helpers.js';
import { TestClient, browserEndpoint, browserServerPort } from '../helpers/client.js';
import { impairmentProxy } from '../helpers/impairment.js';

test('pending ready interruption remains visible after authoritative reconnect; no delayed replay', async ({ page }) => {
  const proxy = await impairmentProxy(browserServerPort);
  try {
    await page.addInitScript(endpoint => {
      const Native = window.WebSocket;
      window.WebSocket = class extends Native {
        constructor(url: string | URL, protocols?: string | string[]) {
          const parsed = new URL(String(url));
          if (parsed.host === location.host && parsed.pathname.split('/').length === 3) parsed.host = new URL(endpoint).host;
          super(parsed, protocols);
        }
      };
    }, proxy.endpoint);
    const view = observe(page);
    await enter(page, 'Gián đoạn');
    proxy.cutNextApplication();
    await page.getByRole('button', { name: 'Mình sẵn sàng' }).click();
    await expect(page.locator('#network')).toBeVisible();
    await expect(page.locator('#network')).toBeHidden();
    await expect(page.locator('#toasts')).toContainText('chưa được xác nhận');
    await expect(page.getByRole('button', { name: 'Mình sẵn sàng' })).toBeVisible();
    expect(view.snapshot!.players[0]!.ready).toBe(false);
    expect(view.errors).toEqual([]);
  } finally { await page.close(); await proxy.close(); }
});

test('first/reconnect snapshots never replay old ping audio; new peer pings play exactly once', async ({ page }) => {
  await page.route('**/src/main.ts', async route => {
    // Test-only audio observation before main is evaluated; leaves actual audio method intact.
    const response = await route.fetch();
    await route.fulfill({ response, body: `import { CampusAudio as ObservedAudio } from '/src/audio.ts';
      window.pingSounds = 0;
      const originalPlay = ObservedAudio.prototype.play;
      ObservedAudio.prototype.play = function(name) { if (name === 'ping') window.pingSounds++; return originalPlay.call(this, name); };
      ${await response.text()}` });
  });
  const proxy = await impairmentProxy(browserServerPort);
  const peers: TestClient[] = [];
  try {
    await page.addInitScript(endpoint => {
      const Native = window.WebSocket;
      window.WebSocket = class extends Native {
        constructor(url: string | URL, protocols?: string | string[]) {
          const parsed = new URL(String(url));
          if (parsed.host === location.host && parsed.pathname.split('/').length === 3) parsed.host = new URL(endpoint).host;
          super(parsed, protocols);
        }
      };
    }, proxy.endpoint);
    const view = observe(page); await enter(page, 'Âm báo');
    const peer = await TestClient.join(browserEndpoint, await page.locator('#invite-code').innerText()); peers.push(peer);
    await peer.act({ type: 'ready', ready: true });
    await page.getByRole('button', { name: 'Mình sẵn sàng' }).click();
    await page.getByRole('button', { name: 'Cùng vào sân trường' }).click();
    await expect(page.getByRole('button', { name: 'Vào sân · Bật điều khiển chuột' })).toBeVisible();
    proxy.disconnect();
    await expect(page.getByRole('heading', { name: 'Đang tìm lại nhóm bạn…' })).toBeVisible();
    await peer.act({ type: 'ping', targetId: peer.room.sessionId, preset: 'help' });
    await expect(page.getByRole('button', { name: 'Tiếp tục · Bật điều khiển chuột' })).toBeEnabled();
    await expect.poll(() => view.snapshot?.pings.length).toBe(1);
    expect(await page.evaluate(() => (window as any).pingSounds)).toBe(0);
    await page.waitForTimeout(800); await peer.act({ type: 'ping', targetId: peer.room.sessionId, preset: 'here' });
    await expect.poll(() => page.evaluate(() => (window as any).pingSounds)).toBe(1);
    await page.waitForTimeout(300); expect(await page.evaluate(() => (window as any).pingSounds)).toBe(1);
    expect(view.errors).toEqual([]);
  } finally { for (const p of peers) await p.room.leave(); await page.close(); await proxy.close(); }
});

test('join form rejects whitespace-only names/codes and trims valid name before connecting', async ({ page }) => {
  const view = observe(page);
  await page.goto('/'); await page.waitForLoadState('networkidle');
  await expect(page.getByRole('button', { name: /Tạo phòng cùng bạn/ })).toBeEnabled({ timeout: 60000 });
  await page.getByLabel('Bạn tên là gì?').fill('   ');
  await page.getByRole('button', { name: /Tạo phòng cùng bạn/ }).click();
  await expect(page.locator('#toasts')).toContainText('Đặt tên');
  expect(view.welcome).toBeUndefined();
  await page.getByLabel('Bạn tên là gì?').fill('  An  ');
  await page.getByLabel('Mã phòng', { exact: true }).fill('   ');
  await page.getByRole('button', { name: 'Tham gia phòng', exact: true }).click();
  await expect(page.locator('#toasts')).toContainText('Mã phòng gồm 8');
  expect(view.welcome).toBeUndefined();
  await page.getByRole('button', { name: /Tạo phòng cùng bạn/ }).click();
  await expect(page.locator('#invite-code')).toBeVisible();
  await expect.poll(() => view.snapshot?.players[0]?.name).toBe('An');
  expect(view.errors).toEqual([]);
});

test('initial authoritative snapshot establishes ping watermark without an audio burst (presentation fixture)', async ({ page }) => {
  await page.route('**/src/main.ts', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `import { CampusAudio as ObservedAudio } from '/src/audio.ts';
      import { Session as ObservedSession } from '/src/session.ts';
      window.pingSounds = 0;
      const observedPlay = ObservedAudio.prototype.play;
      ObservedAudio.prototype.play = function(name) { if (name === 'ping') window.pingSounds++; return observedPlay.call(this, name); };
      const connect = ObservedSession.prototype.connect;
      ObservedSession.prototype.connect = function(...args) {
        const snapshot = this.events.snapshot; let first = true;
        this.events.snapshot = (s, reconnect) => {
          if (first) { first = false; s = { ...s, pings: [1, 2, 3].map(id => ({ id, playerId: 'peer', targetId: 'clue-board', preset: 'help', expiresAt: 4000 })) }; }
          snapshot(s, reconnect);
        };
        return connect.apply(this, args);
      };
      ${await response.text()}` });
  });
  await enter(page, 'Lịch sử ping');
  expect(await page.evaluate(() => (window as any).pingSounds)).toBe(0);
});
