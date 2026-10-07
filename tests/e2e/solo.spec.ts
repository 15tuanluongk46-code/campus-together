import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { CollisionWorld, TARGETS, type SymbolId } from '@campus/shared';
import { observe, walk } from './helpers.js';
import { TestClient, browserEndpoint } from '../helpers/client.js';
import { enter } from './helpers.js';

test('title keeps edited name and room through delayed assets and settings; modal announcements stay accessible', async ({ page }) => {
  let release!: () => void; const gate = new Promise<void>(r => release = r);
  await page.route('**/assets/manifest.json', async route => { await gate; await route.continue(); });
  await page.goto('/');
  await page.getByLabel('Bạn tên là gì?').fill('Tên đang nhập');
  await page.getByLabel('Mã phòng', { exact: true }).fill('ABCDEFGH');
  release();
  await expect(page.locator('[data-submit="create"]')).toBeEnabled({ timeout: 60000 });
  await expect(page.getByLabel('Bạn tên là gì?')).toHaveValue('Tên đang nhập');
  await expect(page.getByLabel('Mã phòng', { exact: true })).toHaveValue('ABCDEFGH');
  await page.getByRole('button', { name: 'Mở cài đặt' }).click();
  expect(await page.locator('#toasts').evaluate(e => !!e.closest('[inert]'))).toBe(false);
  expect(await page.locator('#announcements').evaluate(e => !!e.closest('[inert]'))).toBe(false);
  await page.evaluate(() => document.querySelector<HTMLInputElement>('#guest-name')!.focus());
  expect(await page.evaluate(() => !!document.activeElement?.closest('#modal'))).toBe(true);
  await page.getByRole('button', { name: 'Xong rồi' }).click();
  await expect(page.getByLabel('Bạn tên là gì?')).toHaveValue('Tên đang nhập');
  await expect(page.getByLabel('Mã phòng', { exact: true })).toHaveValue('ABCDEFGH');
});

test('lobby blocks start for a third reserved seat and enables it after reconnect', async ({ page }) => {
  const view = observe(page); await enter(page, 'Trưởng nhóm');
  const code = await page.locator('#invite-code').innerText();
  const a = await TestClient.join(browserEndpoint, code, 'Bạn 2');
  const b = await TestClient.join(browserEndpoint, code, 'Bạn 3');
  let restored: TestClient | undefined;
  try {
    await a.act({ type: 'ready', ready: true }); await b.act({ type: 'ready', ready: true });
    await page.getByRole('button', { name: 'Mình sẵn sàng' }).click();
    await expect(page.locator('[data-action="start"]')).toBeEnabled();
    const token = b.room.reconnectionToken; b.room.connection.close(4010);
    await expect(page.locator('[data-action="start"]')).toBeDisabled(); await expect(page.locator('.lobby-hint')).toContainText('giữ chỗ');
    restored = new TestClient(await b.client.reconnect(token), b.client);
    await expect(page.locator('[data-action="start"]')).toBeEnabled(); expect(view.errors).toEqual([]);
  } finally { if (a.room.connection.isOpen) await a.room.leave(); if (restored?.room.connection.isOpen) await restored.room.leave(); }
});

test('solo title → onboarding → keyboard whole round → results → replay; pause stop/no spam and phase-scoped symbol keys', async ({ page }, info) => {
  test.setTimeout(1000000);
  const view = observe(page), world = await CollisionWorld.create();
  try {
    await page.setViewportSize({ width: 1100, height: 720 });
    await page.addInitScript(() => localStorage.setItem('campus-settings', JSON.stringify({ quality: 'low', music: 0, effects: 0 })));
    await page.addInitScript(() => {
      const Native = window.WebSocket;
      const sockets: WebSocket[] = []; Object.assign(window, { soloSockets: sockets });
      window.WebSocket = class extends Native {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          if (new URL(String(url)).pathname.split('/').length === 3) sockets.push(this);
        }
      };
    });
    await page.goto('/'); await page.waitForLoadState('networkidle');
    await page.getByLabel('Bạn tên là gì?').fill('Một mình vẫn vui');
    await page.getByRole('button', { name: 'Chơi một mình', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Vào sân · Bật điều khiển chuột' })).toBeVisible();
    await expect.poll(() => view.snapshot?.mode).toBe('solo');
    const me = () => view.snapshot!.players.find(p => p.id === view.welcome!.playerId)!;
    const target = (id: string) => TARGETS.find(t => t.id === id)!.position;
    const item = (id: string) => view.snapshot!.items.find(i => i.id === id)!;
    const before = { ...me().position };
    await page.keyboard.press('KeyW', { delay: 300 }); expect(me().position).toEqual(before);
    await expect(TestClient.join(browserEndpoint, view.snapshot!.roomCode)).rejects.toThrow();
    await page.screenshot({ path: info.outputPath('solo-onboarding.png') });
    await page.getByRole('button', { name: 'Vào sân · Bật điều khiển chuột' }).click();
    await expect.poll(() => page.evaluate(() => !!document.pointerLockElement)).toBe(true);
    await page.keyboard.down('KeyS'); await expect.poll(() => me().moving).toBe(true);
    await page.evaluate(() => document.exitPointerLock());
    await expect(page.getByRole('heading', { name: 'Nghỉ một nhịp nhé.' })).toBeVisible();
    await page.keyboard.up('KeyS'); await page.waitForTimeout(200);
    expect(view.input).toMatchObject({ x: 0, z: 0 });
    const seq = view.input!.seq, sent = view.sent.filter(f => f.type === 'input').length;
    const stopped = { ...me().position }; await page.waitForTimeout(700);
    expect(view.sent.filter(f => f.type === 'input')).toHaveLength(sent); expect(me().position).toEqual(stopped);
    await page.getByRole('button', { name: 'Tiếp tục · Bật điều khiển chuột' }).click();
    await page.keyboard.press('KeyW', { delay: 250 }); await expect.poll(() => me().ackSeq > seq).toBe(true);
    await walk(page, view, world, target('gate-switch'));
    // CDP round trips can exceed the whole one-second charge on software WebGL.
    // Schedule the pause in the browser event loop, measuring the actual interval.
    await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('#campus')!;
      canvas.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', bubbles: true }));
      setTimeout(() => { document.exitPointerLock(); canvas.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE', bubbles: true })); }, 250);
    });
    await expect(page.getByRole('heading', { name: 'Nghỉ một nhịp nhé.' })).toBeVisible();
    await expect.poll(() => me().holdTarget).toBeNull();
    expect(view.snapshot!.gateOpen).toBe(false); expect(view.snapshot!.gateChargeMs).toBe(0);
    await page.getByRole('button', { name: 'Tiếp tục · Bật điều khiển chuột' }).click();
    await page.keyboard.down('KeyE'); await expect.poll(() => view.snapshot!.gateOpen).toBe(true);
    await page.keyboard.up('KeyE'); await expect(page.locator('#gate-status')).toContainText('giây');
    const deliver = async (id: string, socket: string) => {
      await walk(page, view, world, item(id).position); await expect(page.locator('#context')).toContainText('Nhặt');
      await page.keyboard.press('KeyE'); await expect.poll(() => me().heldItemId).toBe(id);
      if (id === 'crate-a') {
        await page.screenshot({ path: info.outputPath('solo-carry.png') });
        const revision = item(id).revision;
        await page.evaluate(() => document.exitPointerLock());
        await page.getByRole('button', { name: 'Rời phòng', exact: true }).click();
        await page.getByRole('button', { name: 'Ở lại', exact: true }).click();
        expect(me().heldItemId).toBe(id); expect(item(id).revision).toBe(revision);
        await page.getByRole('button', { name: 'Tiếp tục · Bật điều khiển chuột' }).click();
        await expect.poll(() => page.evaluate(() => !!document.pointerLockElement)).toBe(true);
        await walk(page, view, world, target('gate-switch'));
        await expect(page.locator('#context')).toHaveAttribute('data-status', 'blocked');
        await expect(page.locator('#context')).toContainText('G');
        const count = view.sent.length;
        await page.keyboard.press('KeyE', { delay: 400 });
        expect(view.sent.slice(count).filter(f => f.type === 'intent' && f.data.type === 'hold' && f.data.active)).toEqual([]);
        expect(me().heldItemId).toBe(id);
      }
      await walk(page, view, world, target(socket)); await expect(page.locator('#context')).toContainText('Lắp');
      await page.keyboard.press('KeyE'); await expect.poll(() => item(id).targetId).toBe(socket);
    };
    for (const [id, socket] of [['crate-a', 'decor-a'], ['crate-b', 'decor-b'], ['cable', 'cable-socket'], ['fuse', 'fuse-socket']] as const) await deliver(id, socket);
    await expect.poll(() => view.snapshot?.phase).toBe('power');
    await walk(page, view, world, target('clue-board')); await page.keyboard.press('KeyE');
    await expect(page.locator('#clue-card')).toBeVisible();
    await page.screenshot({ path: info.outputPath('solo-retained-clue.png') });
    const texts = await page.locator('#clue-card .symbol-badge').allTextContents();
    await expect(page.locator('#clue-card button')).toHaveCount(0);
    const order = texts.map(t => t.includes('Mặt trời') ? 'sun' : t.includes('Chiếc lá') ? 'leaf' : 'wave') as SymbolId[];
    const reconnect = async () => {
      const id = view.welcome!.playerId;
      await page.evaluate(() => (window as any).soloSockets.at(-1).close(4010));
      await expect(page.getByRole('button', { name: 'Tiếp tục · Bật điều khiển chuột' })).toBeEnabled();
      await expect.poll(() => me().connected).toBe(true); expect(view.welcome!.playerId).toBe(id);
      await page.getByRole('button', { name: 'Tiếp tục · Bật điều khiển chuột' }).click();
      await expect.poll(() => page.evaluate(() => !!document.pointerLockElement)).toBe(true);
    };
    await reconnect(); await expect(page.locator('#clue-card')).toBeVisible();
    expect(await page.locator('#clue-card .symbol-badge').allTextContents()).toEqual(texts);
    await page.keyboard.press('Digit1'); await expect.poll(() => view.snapshot!.pings.length).toBeGreaterThan(0);
    await page.evaluate(() => document.exitPointerLock()); await page.waitForTimeout(900);
    const pings = () => view.sent.filter(f => f.type === 'intent' && f.data.type === 'ping').length;
    const pausedPings = pings(); await page.keyboard.press('Digit2'); await page.waitForTimeout(200); expect(pings()).toBe(pausedPings);
    await page.getByRole('button', { name: 'Tiếp tục · Bật điều khiển chuột' }).click();
    for (const [slot, symbol] of order.entries()) await deliver(`module-${symbol}`, `power-${slot}`);
    await expect.poll(() => view.snapshot?.phase).toBe('launch');
    const launchPings = pings(); await page.keyboard.press('Digit1'); await page.waitForTimeout(200); expect(pings()).toBe(launchPings);
    await deliver('banner', 'banner-socket'); await deliver('lantern', 'lantern-socket');
    await walk(page, view, world, target('station-b'));
    await expect(page.locator('#context')).toHaveAttribute('data-status', 'blocked');
    await expect(page.locator('#context')).toContainText('trạm A');
    const beforeB = view.sent.length; await page.keyboard.press('KeyE', { delay: 350 });
    expect(view.sent.slice(beforeB).filter(f => f.type === 'intent' && f.data.type === 'hold' && f.data.active)).toEqual([]);
    await walk(page, view, world, target('station-a')); await page.keyboard.down('KeyE');
    await expect.poll(() => view.snapshot!.stationAComplete).toBe(true); await page.keyboard.up('KeyE');
    await expect(page.locator('#context')).toHaveAttribute('data-status', 'completed');
    await expect(page.locator('#context')).toContainText('trạm B');
    const afterA = view.sent.length; await page.keyboard.press('KeyE', { delay: 350 });
    expect(view.sent.slice(afterA).filter(f => f.type === 'intent' && f.data.type === 'hold' && f.data.active)).toEqual([]);
    await reconnect(); expect(view.snapshot!.stationAComplete).toBe(true);
    await expect(page.locator('#mission-detail')).toContainText('trạm B'); await page.screenshot({ path: info.outputPath('solo-a-latched.png') });
    await walk(page, view, world, target('station-b')); await page.keyboard.down('KeyE');
    await expect.poll(() => view.snapshot!.result).toBe('success'); await page.keyboard.up('KeyE');
    await expect(page.getByRole('heading', { name: 'Lễ hội đã sáng đèn!' })).toBeVisible();
    await expect(page.locator('.result-sheet')).toContainText('Chơi một mình'); expect(view.snapshot!.score).toBe(1300);
    await page.screenshot({ path: info.outputPath('solo-results.png') });
    await writeFile(info.outputPath('solo-authority.json'), JSON.stringify({ snapshot: view.snapshot, frames: view.frames, meanSnapshotBytes: view.bytes / view.frames, errors: view.errors, warnings: view.warnings, pausedInputCount: sent }, null, 2));
    await page.getByRole('button', { name: 'Hẹn thêm một lượt nữa' }).click();
    await expect.poll(() => view.snapshot!.roundId).toBe(2); expect(view.snapshot).toMatchObject({ mode: 'solo', phase: 'supply', score: 0, stationAComplete: false });
    await expect(page.locator('[data-action="start"]')).toHaveCount(0);
    await expect(page.locator('[data-action="ready"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Vào sân · Bật điều khiển chuột' })).toBeVisible();
    await page.screenshot({ path: info.outputPath('solo-replay.png') }); expect(view.errors).toEqual([]);
  } finally { world.dispose(); }
});
