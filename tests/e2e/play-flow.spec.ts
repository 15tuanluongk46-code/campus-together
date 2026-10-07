import { test, expect } from '@playwright/test';
import { TestClient, browserEndpoint } from '../helpers/client.js';
import { observe } from './helpers.js';

test('audio failure is nonfatal and correctly explained; pointer rejection leaves usable resume', async ({ page }) => {
  await page.addInitScript(() => {
    window.AudioContext = class { constructor() { throw new Error('test audio denied'); } } as any;
    const original = HTMLCanvasElement.prototype.requestPointerLock;
    let denied = false;
    HTMLCanvasElement.prototype.requestPointerLock = function (...args) {
      if (!denied) { denied = true; return Promise.reject(new Error('test pointer denied')); }
      return original.apply(this, args);
    };
  });
  const view = observe(page);
  await page.goto('/'); await page.waitForLoadState('networkidle');
  await page.getByLabel('Bạn tên là gì?').fill('Âm thanh');
  await page.getByRole('button', { name: 'Chơi một mình', exact: true }).click();
  await page.getByRole('button', { name: 'Vào sân · Bật điều khiển chuột' }).click();
  await expect(page.locator('#toasts')).toContainText('chuột');
  await expect(page.getByRole('button', { name: 'Tiếp tục · Bật điều khiển chuột' })).toBeVisible();
  await page.getByRole('button', { name: 'Tiếp tục · Bật điều khiển chuột' }).click();
  await expect(page.locator('#modal')).toBeEmpty(); await expect(page.locator('#toasts')).toContainText('âm thanh');
  await page.keyboard.press('KeyS', { delay: 250 }); await expect.poll(() => view.input?.seq ?? -1).toBeGreaterThan(0);
  expect(view.errors).toEqual([]);
});

test('Enter in room code joins invitation; invalid code preserves inputs and never creates Solo', async ({ page }) => {
  const host = await TestClient.create(browserEndpoint);
  try {
    const view = observe(page);
    await page.goto(`/?room=${host.room.roomId}`); await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-submit="join"]')).toBeEnabled({ timeout: 60000 });
    await page.getByLabel('Bạn tên là gì?').fill('Enter guest');
    await page.getByLabel('Mã phòng', { exact: true }).fill('BAD');
    await page.getByLabel('Mã phòng', { exact: true }).press('Enter');
    await expect(page.locator('#toasts')).toContainText('Mã phòng'); expect(view.welcome).toBeUndefined();
    await expect(page.getByLabel('Bạn tên là gì?')).toHaveValue('Enter guest');
    await page.getByLabel('Mã phòng', { exact: true }).fill(host.room.roomId);
    await page.getByLabel('Mã phòng', { exact: true }).press('Enter');
    await expect(page.locator('#invite-code')).toHaveText(host.room.roomId);
    expect(view.snapshot?.mode).toBe('coop'); expect(view.errors).toEqual([]);
  } finally { await host.room.leave(); }
});

test('active leave offers focused Stay, Escape cancels without leave/input mutation, confirm leaves', async ({ page }) => {
  const view = observe(page);
  await page.goto('/'); await page.waitForLoadState('networkidle');
  await page.getByLabel('Bạn tên là gì?').fill('Ở lại');
  await page.getByRole('button', { name: 'Chơi một mình', exact: true }).click();
  await expect(page.locator('.play-dialog')).toBeVisible();
  const before = view.snapshot!;
  await page.getByRole('button', { name: 'Rời phòng', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('không được lưu');
  await expect(page.getByRole('button', { name: 'Ở lại', exact: true })).toBeFocused();
  const count = view.sent.length;
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Tiếp tục · Bật điều khiển chuột' })).toBeFocused();
  expect(view.sent.slice(count).filter(f => f.type === 'intent' || f.type === 'input')).toEqual([]);
  expect(view.snapshot!.roundId).toBe(before.roundId); expect(view.snapshot!.players).toEqual(before.players);
  await page.getByRole('button', { name: 'Rời phòng', exact: true }).click();
  await page.getByRole('button', { name: 'Rời lượt chơi', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Chơi một mình', exact: true })).toBeVisible();
  expect(view.errors).toEqual([]);
});

test('failed join retry preserves typed fields and actionable server feedback', async ({ page }) => {
  await page.goto('/'); await page.waitForLoadState('networkidle');
  await page.getByLabel('Bạn tên là gì?').fill('Tên còn nguyên');
  await page.getByLabel('Mã phòng', { exact: true }).fill('ABCDEFGH');
  await page.getByLabel('Mã phòng', { exact: true }).press('Enter');
  await expect(page.getByRole('alertdialog')).toContainText('Không tìm thấy phòng');
  await page.getByRole('button', { name: 'Sửa tên / mã phòng' }).click();
  await expect(page.getByLabel('Bạn tên là gì?')).toHaveValue('Tên còn nguyên');
  await expect(page.getByLabel('Mã phòng', { exact: true })).toHaveValue('ABCDEFGH');
  await expect(page.locator('#toasts')).toContainText('Không tìm thấy phòng');
});

test('Input owner serializes pending physical requests and stale completion cannot enable disposed input', async ({ page }) => {
  await page.goto('/'); await page.waitForLoadState('networkidle');
  const result = await page.evaluate(async () => {
    window.dispatchEvent(new Event('pagehide'));
    const path = '/src/input.ts'; const { Input } = await import(/* @vite-ignore */ path);
    const canvas = document.createElement('canvas'); document.body.append(canvas);
    let calls = 0, resolve!: () => void;
    let locked: Element | null = null;
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => locked });
    document.exitPointerLock = () => { locked = null; document.dispatchEvent(new Event('pointerlockchange')); };
    canvas.requestPointerLock = () => { calls++; return new Promise<void>(r => resolve = () => { locked = canvas; document.dispatchEvent(new Event('pointerlockchange')); r(); }); };
    const input = new Input(canvas, () => {}, () => {}, () => {});
    const first = input.lock().catch(() => {}); input.unlock();
    await input.lock().catch(() => {});
    const during = { calls, enabled: input.enabled };
    resolve(); await first;
    const stale = { enabled: input.enabled, locked: !!locked };
    const next = input.lock().catch(() => {}); input.dispose(); resolve(); await next;
    const disposed = { enabled: input.enabled, locked: !!locked };
    canvas.remove(); return { during, stale, disposed };
  });
  expect(result).toEqual({ during: { calls: 1, enabled: false }, stale: { enabled: false, locked: false }, disposed: { enabled: false, locked: false } });
});

test('activation cancelled by leaving cannot hide a new session onboarding when its old audio resolves', async ({ page }) => {
  await page.route('**/src/main.ts', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `import { CampusAudio as DeferredAudio } from '/src/audio.ts';
      let release; const pendingAudio = new Promise(resolve => release = resolve);
      window.releaseAudio = release;
      DeferredAudio.prototype.activate = () => pendingAudio;
      ${await response.text()}` });
  });
  const view = observe(page);
  await page.goto('/'); await page.waitForLoadState('networkidle');
  await page.getByLabel('Bạn tên là gì?').fill('Async owner');
  await page.getByRole('button', { name: 'Chơi một mình', exact: true }).click();
  await page.getByRole('button', { name: 'Vào sân · Bật điều khiển chuột' }).click();
  await expect(page.locator('#modal')).toBeEmpty();
  await page.evaluate(() => document.exitPointerLock());
  await page.getByRole('button', { name: 'Rời phòng', exact: true }).click();
  await page.getByRole('button', { name: 'Rời lượt chơi', exact: true }).click();
  await page.getByRole('button', { name: 'Chơi một mình', exact: true }).click();
  await expect(page.locator('.play-dialog')).toBeVisible();
  await page.evaluate(() => (window as any).releaseAudio());
  await expect(page.locator('.play-dialog')).toBeVisible();
  expect(await page.evaluate(() => !!document.pointerLockElement)).toBe(false); expect(view.errors).toEqual([]);
});

test('normal Escape key opens the pause flow and releases held input', async ({ page }) => {
  const view = observe(page);
  await page.goto('/'); await page.waitForLoadState('networkidle');
  await page.getByLabel('Bạn tên là gì?').fill('Escape');
  await page.getByRole('button', { name: 'Chơi một mình', exact: true }).click();
  await page.getByRole('button', { name: 'Vào sân · Bật điều khiển chuột' }).click();
  await page.keyboard.down('KeyS'); await page.keyboard.press('Escape'); await page.keyboard.up('KeyS');
  await expect(page.getByRole('button', { name: 'Tiếp tục · Bật điều khiển chuột' })).toBeVisible({ timeout: 3000 });
  expect(await page.evaluate(() => !!document.pointerLockElement)).toBe(false);
  expect(view.input).toMatchObject({ x: 0, z: 0 });
});
