import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { CollisionWorld, TARGETS, type SymbolId } from '@campus/shared';
import { TestClient, sleep, until, browserEndpoint } from '../helpers/client.js';
import { enter, observe, walk } from './helpers.js';
test('full rendered round with keyboard carry, private clue, hold heartbeats, festival and replay', async ({ page }, info) => {
  test.setTimeout(660000);
  const view = observe(page); const world = await CollisionWorld.create();
  let peer: TestClient | undefined;
  try {
    await page.setViewportSize({ width: 1100, height: 720 });
    await page.addInitScript(() => localStorage.setItem('campus-settings', JSON.stringify({ quality: 'low', music: 0, effects: 0 })));
    await enter(page, 'An');
    const code = (await page.locator('#invite-code').innerText()).trim();
    peer = await TestClient.join(browserEndpoint, code, 'Bình');
    await peer.act({ type: 'ready', ready: true });
    await page.getByRole('button', { name: 'Mình sẵn sàng' }).click(); await page.getByRole('button', { name: 'Cùng vào sân trường' }).click();
    await page.getByRole('button', { name: 'Vào sân · Bật điều khiển chuột' }).click();
    await expect.poll(() => page.evaluate(() => !!document.pointerLockElement)).toBe(true);
    const me = () => view.snapshot!.players.find(p => p.id === view.welcome!.playerId)!;
    const target = (id: string) => TARGETS.find(t => t.id === id)!;
    const item = (id: string) => view.snapshot!.items.find(i => i.id === id)!;
    await walk(page, view, world, target('gate-switch').position);
    await expect(page.locator('#context')).toContainText('Giữ mở cổng');
    await page.keyboard.down('KeyE'); await expect.poll(() => view.snapshot!.gateOpen).toBe(true);
    await page.waitForTimeout(650); expect(view.snapshot!.gateOpen).toBe(true);
    await page.keyboard.up('KeyE'); await expect.poll(() => view.snapshot!.gateOpen).toBe(false);
    await walk(page, view, world, item('crate-a').position);
    await expect(page.locator('#context')).toContainText('Nhặt');
    await page.screenshot({ path: info.outputPath('06-storage.png') });
    await page.keyboard.press('KeyE'); await expect.poll(() => me().heldItemId).toBe('crate-a'); await page.waitForTimeout(1100);
    await page.screenshot({ path: info.outputPath('07-carry-crate.png') });
    await page.keyboard.press('KeyG'); await expect.poll(() => me().heldItemId).toBeNull();
    await page.waitForTimeout(250); await page.keyboard.press('KeyE'); await expect.poll(() => me().heldItemId).toBe('crate-a');
    await walk(page, view, world, { x: -10, y: 0, z: 10 });
    await page.screenshot({ path: info.outputPath('08-street.png') });
    await walk(page, view, world, target('decor-a').position);
    await page.keyboard.press('KeyE'); await expect.poll(() => item('crate-a').state).toBe('DELIVERED');
    // Other teammate performs actual movement/intent via the unmodified server.
    const deliver = async (itemId: string, targetId: string) => {
      const i = peer!.snapshot.items.find(i => i.id === itemId)!;
      await peer!.walk(world, i.position); const pickup = await peer!.act({ type: 'pickup', itemId, expectedRevision: i.revision }); expect(pickup.ok, pickup.message).toBe(true);
      await until(() => peer!.player.heldItemId === itemId);
      await peer!.walk(world, target(targetId).position);
      const place = await peer!.act({ type: 'place', itemId, expectedRevision: peer!.snapshot.items.find(i => i.id === itemId)!.revision, targetId }); expect(place.ok, place.message).toBe(true);
      await until(() => peer!.player.heldItemId === null);
    };
    await deliver('crate-b', 'decor-b'); await deliver('cable', 'cable-socket'); await deliver('fuse', 'fuse-socket');
    await expect.poll(() => view.snapshot?.phase).toBe('power');
    await expect.poll(() => page.evaluate(() => !!document.pointerLockElement)).toBe(true);
    await walk(page, view, world, { x: 5, y: 0, z: -11 }); await page.screenshot({ path: info.outputPath('09-corridor.png') });
    await walk(page, view, world, target('clue-board').position); await page.keyboard.press('KeyE');
    await expect(page.locator('#clue-card')).toBeVisible(); await page.screenshot({ path: info.outputPath('10-classroom-clue.png') });
    await page.keyboard.press('Digit1'); await expect.poll(() => view.snapshot!.pings.length).toBeGreaterThan(0);
    // Read the visible private clue; do not infer clue order from layout.
    const texts = await page.locator('#clue-card .symbol-badge').allTextContents();
    const order = texts.map(text => text.includes('Mặt trời') ? 'sun' : text.includes('Chiếc lá') ? 'leaf' : 'wave') as SymbolId[];
    for (const [slot, symbol] of order.entries()) await deliver(`module-${symbol}`, `power-${slot}`);
    await expect.poll(() => view.snapshot?.phase).toBe('launch');
    await deliver('banner', 'banner-socket'); await deliver('lantern', 'lantern-socket');
    await walk(page, view, world, target('station-a').position); await peer.walk(world, target('station-b').position);
    await page.screenshot({ path: info.outputPath('11-stage-ready.png') });
    await page.keyboard.down('KeyE');
    const deadline = Date.now() + 10000;
    while (peer.snapshot.phase !== 'results' && Date.now() < deadline) { await peer.act({ type: 'hold', targetId: 'station-b', active: true }); await sleep(120); }
    await page.keyboard.up('KeyE');
    await expect.poll(() => view.snapshot?.result).toBe('success');
    await expect(page.getByRole('heading', { name: 'Lễ hội đã sáng đèn!' })).toBeVisible();
    await page.waitForTimeout(1200); await page.screenshot({ path: info.outputPath('12-festival-results.png') });
    expect(view.snapshot!.score).toBe(1300);
    await info.attach('whole-round-authority', { body: JSON.stringify({ snapshot: view.snapshot, frames: view.frames, meanSnapshotBytes: view.bytes / view.frames, errors: view.errors, warnings: view.warnings }, null, 2), contentType: 'application/json' });
    await writeFile(info.outputPath('whole-round-authority.json'), JSON.stringify({ snapshot: view.snapshot, frames: view.frames, meanSnapshotBytes: view.bytes / view.frames, errors: view.errors, warnings: view.warnings }, null, 2));
    await page.getByRole('button', { name: 'Hẹn thêm một lượt nữa' }).click();
    await expect(page.getByRole('heading', { name: 'Nhóm của chúng mình' })).toBeVisible();
    await expect.poll(() => view.snapshot!.roundId).toBe(2); expect(view.snapshot!.score).toBe(0); expect(view.snapshot!.players.every(p => !p.ready && !p.heldItemId)).toBe(true);
    await page.screenshot({ path: info.outputPath('13-replay-lobby.png') });
    expect(view.errors).toEqual([]);
  } finally { await peer?.room.leave(); world.dispose(); }
});
