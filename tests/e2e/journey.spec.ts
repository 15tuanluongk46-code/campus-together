import { test, expect, type Page } from '@playwright/test';
import { decode } from '@colyseus/schema';
import { unpack } from 'msgpackr';
import type { GameSnapshot, Welcome } from '@campus/shared';

/** Read-only protocol observer. No writes, production hooks, teleports or injected game state. */
function observe(page: Page) {
  const view: { snapshot?: GameSnapshot; welcome?: Welcome; frames: number; bytes: number; errors: string[] } = { frames: 0, bytes: 0, errors: [] };
  page.on('pageerror', e => view.errors.push(e.message));
  page.on('websocket', ws => ws.on('framereceived', ({ payload }) => {
    if (typeof payload === 'string' || payload[0] !== 13) return;
    const iterator = { offset: 1 }; const type = decode.stringCheck(payload, iterator) ? decode.string(payload, iterator) : decode.number(payload, iterator);
    if (type === 'snapshot') { view.snapshot = unpack(payload.subarray(iterator.offset)) as GameSnapshot; view.frames++; view.bytes += payload.length; }
    if (type === 'welcome') view.welcome = unpack(payload.subarray(iterator.offset)) as Welcome;
  }));
  return view;
}
async function enter(page: Page, name: string, room?: string) {
  await page.goto(room ? `/?room=${room}` : '/'); await page.waitForLoadState('networkidle');
  await expect(page.getByRole('button', { name: /Tạo phòng cùng bạn/ })).toBeEnabled({ timeout: 60000 });
  await page.getByLabel('Bạn tên là gì?').fill(name);
  await page.getByRole('button', { name: room ? 'Tham gia phòng' : /Tạo phòng cùng bạn/ }).click();
  await expect(page.getByRole('heading', { name: 'Nhóm của chúng mình' })).toBeVisible();
}
test('actual browser: title → invite → two ready clients → input/pause/settings → teardown', async ({ browser }, info) => {
  const contextA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const contextB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const a = await contextA.newPage(), b = await contextB.newPage(); const av = observe(a), bv = observe(b);
  await a.goto('/'); await a.waitForLoadState('networkidle'); await expect(a.getByRole('button', { name: /Tạo phòng cùng bạn/ })).toBeEnabled({ timeout: 60000 });
  await a.screenshot({ path: info.outputPath('01-title.png') });
  await a.setViewportSize({ width: 1024, height: 768 });
  expect(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await a.screenshot({ path: info.outputPath('01-title-1024.png') });
  await a.setViewportSize({ width: 1440, height: 900 });
  await a.getByRole('button', { name: 'Mở cài đặt' }).click();
  await a.getByLabel('Nhạc sân trường', { exact: true }).fill('0.1');
  await a.getByRole('button', { name: 'Xong rồi' }).click();
  await expect.poll(() => a.evaluate(() => JSON.parse(localStorage.getItem('campus-settings')!).music)).toBe(.1);
  await a.getByLabel('Bạn tên là gì?').fill('An'); await a.getByRole('button', { name: /Tạo phòng cùng bạn/ }).click();
  await expect(a.getByRole('heading', { name: 'Nhóm của chúng mình' })).toBeVisible();
  const code = (await a.locator('#invite-code').innerText()).trim();
  await expect(a.getByRole('button', { name: 'Cùng vào sân trường' })).toBeDisabled();
  await enter(b, 'Bình', code);
  await a.getByRole('button', { name: 'Mình sẵn sàng' }).click(); await b.getByRole('button', { name: 'Mình sẵn sàng' }).click();
  await expect(a.getByRole('button', { name: 'Cùng vào sân trường' })).toBeEnabled();
  await a.screenshot({ path: info.outputPath('02-lobby.png') });
  await a.getByRole('button', { name: 'Cùng vào sân trường' }).click();
  await expect(a.getByRole('button', { name: 'Vào sân · Bật điều khiển chuột' })).toBeVisible();
  await a.screenshot({ path: info.outputPath('03-onboarding.png') });
  await a.getByRole('button', { name: 'Vào sân · Bật điều khiển chuột' }).click();
  await expect.poll(() => a.evaluate(() => !!document.pointerLockElement)).toBe(true);
  await a.screenshot({ path: info.outputPath('04-courtyard.png') });
  await expect.poll(() => av.snapshot?.phase).toBe('supply');
  const start = av.snapshot!.players.find(p => p.id === av.welcome!.playerId)!.position;
  await a.keyboard.down('KeyS'); await a.waitForTimeout(650); await a.keyboard.up('KeyS');
  await expect.poll(() => av.snapshot!.players.find(p => p.id === av.welcome!.playerId)!.position.z).toBeGreaterThan(start.z + .5);
  await a.evaluate(() => document.exitPointerLock()); await expect(a.getByRole('heading', { name: 'Nghỉ một nhịp nhé.' })).toBeVisible();
  await a.waitForTimeout(400); const stopped = av.snapshot!.players.find(p => p.id === av.welcome!.playerId)!.position;
  await a.waitForTimeout(500); expect(av.snapshot!.players.find(p => p.id === av.welcome!.playerId)!.position).toEqual(stopped);
  await a.getByRole('button', { name: 'Cài đặt', exact: true }).click();
  await a.screenshot({ path: info.outputPath('05-settings.png') });
  await a.getByRole('button', { name: 'Xong rồi' }).click();
  await a.getByRole('button', { name: 'Rời phòng', exact: true }).click();
  await a.getByRole('button', { name: 'Rời lượt chơi', exact: true }).click();
  await expect(a.getByRole('heading', { name: /Hẹn nhau/ })).toBeVisible();
  await expect.poll(() => bv.snapshot?.players.length).toBe(1);
  await a.getByRole('button', { name: /Tạo phòng cùng bạn/ }).click();
  await expect(a.getByRole('heading', { name: 'Nhóm của chúng mình' })).toBeVisible();
  await a.getByRole('button', { name: 'Rời phòng', exact: true }).click();
  await expect(a.getByRole('heading', { name: /Hẹn nhau/ })).toBeVisible();
  expect(av.errors).toEqual([]); expect(bv.errors).toEqual([]);
  await info.attach('network-observations', { body: JSON.stringify({ a: { frames: av.frames, meanSnapshotBytes: av.bytes / av.frames, errors: av.errors }, b: { errors: bv.errors }, end: bv.snapshot }, null, 2), contentType: 'application/json' });
  await contextA.close(); await contextB.close();
});
