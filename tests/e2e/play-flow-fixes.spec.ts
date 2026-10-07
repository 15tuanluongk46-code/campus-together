import { test, expect } from '@playwright/test';
import { TestClient, browserEndpoint } from '../helpers/client.js';
import { observe } from './helpers.js';
import { snapshot } from '../client/fixtures.js';

test('name Enter validates manually typed code, preserves drafts and joins; explicit Solo remains Solo', async ({ page }) => {
  const host = await TestClient.create(browserEndpoint), view = observe(page);
  try {
    await page.goto('/'); await page.waitForLoadState('networkidle');
    const name = page.getByLabel('Bạn tên là gì?'), code = page.getByLabel('Mã phòng', { exact: true });
    await name.fill('Tên nhập tay'); await code.fill('BAD'); await name.press('Enter');
    await expect(page.locator('#toasts')).toContainText('Mã phòng', { timeout: 3000 });
    expect(view.welcome).toBeUndefined(); await expect(name).toHaveValue('Tên nhập tay'); await expect(code).toHaveValue('BAD');
    await code.fill(host.room.roomId); await name.press('Enter');
    await expect(page.locator('#invite-code')).toHaveText(host.room.roomId);
    expect(view.snapshot?.mode).toBe('coop');
    await page.getByRole('button', { name: 'Rời phòng', exact: true }).click();
    await code.fill('BAD'); await page.getByRole('button', { name: 'Chơi một mình', exact: true }).click();
    await expect(page.locator('.play-dialog')).toBeVisible(); expect(view.snapshot?.mode).toBe('solo');
    expect(view.errors).toEqual([]);
  } finally { await host.room.leave(); }
});

test('terminal network state supersedes confirmation, clears Escape cancellation and offers usable exit', async ({ page }) => {
  await page.goto('/'); await page.waitForLoadState('networkidle');
  await page.evaluate(async s => {
    window.dispatchEvent(new Event('pagehide'));
    const path = '/src/ui.ts'; const { UI } = await import(/* @vite-ignore */ path);
    const noop = () => {}; let exits = 0;
    const ui = new UI(document.querySelector('#app'), { quality: 'low', music: 0, effects: 0, sensitivity: 1, reducedMotion: false }, '', {
      connect: noop, cancel: noop, ready: noop, start: noop, replay: noop,
      leave: () => { exits++; ui.reset(); }, play: noop, pause: () => ui.setPaused(true), settings: noop, ping: noop, audio: noop,
    });
    Object.assign(window, { reviewUI: ui, reviewExits: () => exits }); ui.loaded(); ui.connection('online', ''); ui.update(s, 'me');
  }, snapshot());
  await page.getByRole('button', { name: 'Rời phòng', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Ở lại', exact: true })).toBeFocused();
  await page.evaluate(() => (window as any).reviewUI.connection('reconnecting', 'Đang nối lại'));
  await expect(page.getByRole('button', { name: 'Ở lại', exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).reviewUI.connection('ended', 'Máy chủ đã đóng phiên.'));
  await expect(page.getByRole('alertdialog')).toContainText('Máy chủ đã đóng phiên.');
  await expect(page.getByRole('button', { name: 'Ở lại', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Về sân trường', exact: true })).toBeFocused();
  expect(await page.evaluate(() => {
    const e = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true });
    document.dispatchEvent(e); return e.defaultPrevented;
  })).toBe(false);
  await page.getByRole('button', { name: 'Về sân trường', exact: true }).click();
  expect(await page.evaluate(() => (window as any).reviewExits())).toBe(1);
  await expect(page.getByRole('button', { name: 'Chơi một mình', exact: true })).toBeVisible();
});

test('main resume shows neutral busy guidance until cancelled browser request ends, then fresh gesture plays', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.requestPointerLock; let calls = 0;
    Object.assign(window, { pointerCalls: () => calls });
    HTMLCanvasElement.prototype.requestPointerLock = function (...args) {
      if (++calls === 1) return new Promise<void>((_, reject) => Object.assign(window, { endPendingPointer: () => reject(new Error('cancelled browser request')) }));
      return original.apply(this, args);
    };
  });
  const view = observe(page);
  await page.goto('/'); await page.waitForLoadState('networkidle');
  await page.getByLabel('Bạn tên là gì?').fill('Chờ chuột');
  await page.getByRole('button', { name: 'Chơi một mình', exact: true }).click();
  await page.getByRole('button', { name: 'Vào sân · Bật điều khiển chuột' }).click();
  await page.getByRole('button', { name: 'Cài đặt', exact: true }).click();
  await page.getByRole('button', { name: 'Xong rồi' }).click();
  await page.getByRole('button', { name: 'Tiếp tục · Bật điều khiển chuột' }).click();
  await expect(page.locator('#toasts')).toContainText('Đang chờ trình duyệt');
  await expect(page.locator('#toasts')).not.toHaveClass(/error/);
  expect(await page.evaluate(() => (window as any).pointerCalls())).toBe(1);
  await page.evaluate(() => (window as any).endPendingPointer());
  await expect(page.locator('.play-dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Tiếp tục · Bật điều khiển chuột' }).click();
  await expect.poll(() => page.evaluate(() => !!document.pointerLockElement)).toBe(true);
  await expect(page.locator('#modal')).toBeEmpty(); expect(view.errors).toEqual([]);
});

for (const api of ['promise', 'legacy'] as const) test(`activation+Input cancellation/resume, timeout and late grants stay serialized (${api})`, async ({ page }) => {
  await page.goto('/'); await page.waitForLoadState('networkidle');
  await page.clock.install();
  const init = await page.evaluate(async api => {
    window.dispatchEvent(new Event('pagehide'));
    const inputPath = '/src/input.ts', activationPath = '/src/activation.ts';
    const { Input } = await import(/* @vite-ignore */ inputPath);
    const { PlayActivation } = await import(/* @vite-ignore */ activationPath);
    const canvas = document.createElement('canvas'); document.body.append(canvas);
    let locked: Element | null = null, calls = 0, plays = 0, failures = 0, busy = 0;
    const requests: { grant(): void; reject(): void }[] = [];
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => locked });
    document.exitPointerLock = () => { locked = null; document.dispatchEvent(new Event('pointerlockchange')); };
    canvas.requestPointerLock = (() => {
      calls++; let resolve!: () => void, reject!: (e: Error) => void;
      const promise = api === 'promise' ? new Promise<void>((a, b) => { resolve = a; reject = b; }) : undefined;
      requests.push({ grant: () => { locked = canvas; document.dispatchEvent(new Event('pointerlockchange')); resolve?.(); }, reject: () => { if (reject) reject(new Error('denied')); else document.dispatchEvent(new Event('pointerlockerror')); } });
      return promise;
    }) as any;
    const input = new Input(canvas, () => {}, () => {}, () => {});
    const activation = new PlayActivation({ valid: () => true, lock: () => input.lock(), audio: () => Promise.resolve(), playing: () => plays++, failed: () => failures++, silent: () => {}, busy: () => busy++ });
    const read = () => ({ calls, plays, failures, busy, enabled: input.enabled, locked: !!locked });
    const cancel = () => { activation.cancel(); input.unlock(); };
    Object.assign(window, { physicalReview: { input, activation, requests, read, cancel } });
    void activation.start(); cancel(); await activation.start(); return read();
  }, api);
  expect(init).toEqual({ calls: 1, plays: 0, failures: 0, busy: 1, enabled: false, locked: false });
  // Cancelled request grants before deadline: release it, do not auto-resume.
  await page.evaluate(() => (window as any).physicalReview.requests[0].grant());
  expect(await page.evaluate(() => (window as any).physicalReview.read())).toMatchObject({ plays: 0, enabled: false, locked: false });
  // Fresh physical request times out. Timeout is NOT proof that browser request ended.
  await page.evaluate(() => { void (window as any).physicalReview.activation.start(); });
  await page.clock.runFor(4100);
  expect(await page.evaluate(() => (window as any).physicalReview.read())).toMatchObject({ calls: 2, failures: 1, plays: 0 });
  await page.evaluate(async () => { const r = (window as any).physicalReview; r.cancel(); await r.activation.start(); });
  expect(await page.evaluate(() => (window as any).physicalReview.read())).toMatchObject({ calls: 2, failures: 1, busy: 2 });
  await page.evaluate(() => (window as any).physicalReview.requests[1].grant());
  expect(await page.evaluate(() => (window as any).physicalReview.read())).toMatchObject({ plays: 0, enabled: false, locked: false });
  await page.evaluate(() => { void (window as any).physicalReview.activation.start(); });
  await page.evaluate(() => (window as any).physicalReview.requests[2].grant());
  expect(await page.evaluate(() => (window as any).physicalReview.read())).toMatchObject({ calls: 3, plays: 1, failures: 1, enabled: true, locked: true });
  // Promise callback from a previous request must not unlock the newer grant.
  await page.evaluate(() => (window as any).physicalReview.requests[0].reject());
  expect(await page.evaluate(() => (window as any).physicalReview.read())).toMatchObject({ plays: 1, enabled: true, locked: true });
  await page.evaluate(() => (window as any).physicalReview.input.dispose());
});
