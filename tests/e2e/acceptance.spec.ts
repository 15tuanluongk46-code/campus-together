import { test, expect, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { enter, observe } from './helpers.js';
import { TestClient, browserEndpoint } from '../helpers/client.js';
import { meetsTarget } from '../performance/verdict.js';
import type { Vec3 } from '@campus/shared';
// Trace screencasts encode four 1080p surfaces and distort frame scheduling.
test.use({ trace: 'off' });

// Test-owned read-only frame/context instrumentation: no game state hooks.
async function instrument(page: Page) {
  await page.addInitScript(() => {
    const samples: number[] = []; let previous = 0, enabled = false, started = 0, ended = 0, callbacks = 0;
    const frame = (now: number) => { if (enabled) { callbacks++; if (previous) samples.push(now - previous); } previous = now; requestAnimationFrame(frame); }; requestAnimationFrame(frame);
    Object.assign(window, { acceptanceMeter: { start() { samples.length = 0; previous = 0; callbacks = 0; started = performance.now(); ended = 0; enabled = true; setTimeout(() => { enabled = false; ended = performance.now(); }, 15000); }, stop() { enabled = false; ended ||= performance.now(); return { samples: [...samples], callbacks, windowMs: started ? ended - started : 0, visibility: document.visibilityState }; } } });
  });
}
async function startSample(page: Page) { await page.evaluate(() => (window as unknown as { acceptanceMeter: { start(): void } }).acceptanceMeter.start()); }
async function sample(page: Page) {
  return page.evaluate(() => {
    const raw = (window as unknown as { acceptanceMeter: { stop(): { samples: number[]; callbacks: number; windowMs: number; visibility: string } } }).acceptanceMeter.stop();
    const sorted = [...raw.samples].sort((a, b) => a - b);
    const gl = document.querySelector<HTMLCanvasElement>('#campus')!.getContext('webgl2')!;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return { gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), viewport: [innerWidth, innerHeight], drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight], quality: JSON.parse(localStorage.getItem('campus-settings') ?? '{}').quality ?? 'high', frames: sorted.length, callbacks: raw.callbacks, windowMs: raw.windowMs, fps: raw.windowMs ? raw.callbacks * 1000 / raw.windowMs : 0, sampleMs: raw.samples.reduce((a, b) => a + b, 0), p50Ms: sorted[Math.floor(sorted.length * .5)], p95Ms: sorted[Math.floor(sorted.length * .95)], meanMs: raw.samples.reduce((a, b) => a + b, 0) / sorted.length, visibility: raw.visibility };
  });
}

test('1080p diagnostic: one rendered + three socket clients, high and low quality', async ({ browser }, info) => {
  test.setTimeout(360000);
  const contexts = [], pages: Page[] = [], peers: TestClient[] = [];
  const evidence: Record<string, unknown> = {};
  try { evidence.desktopSession = execFileSync('loginctl', ['show-session', process.env.XDG_SESSION_ID ?? 'self', '-p', 'Remote', '-p', 'Type', '-p', 'LockedHint'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { evidence.desktopSession = 'unknown; set XDG_SESSION_ID for the measured desktop'; }
  try {
    for (let i = 0; i < 1; i++) {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } }); contexts.push(ctx);
      const p = await ctx.newPage(); pages.push(p); await instrument(p);
    }
    const a = pages[0]!, view = observe(a); await a.bringToFront();
    await enter(a, 'Một màn hình'); const code = await a.locator('#invite-code').innerText();
    for (let i = 0; i < 3; i++) { const peer = await TestClient.join(browserEndpoint, code, `Socket ${i}`); peers.push(peer); await peer.act({ type: 'ready', ready: true }); }
    await a.getByRole('button', { name: 'Mình sẵn sàng' }).click(); await a.getByRole('button', { name: 'Cùng vào sân trường' }).click();
    await a.getByRole('button', { name: 'Vào sân · Bật điều khiển chuột' }).click();
    await a.waitForTimeout(2500); await startSample(a); await a.waitForTimeout(15000);
    const high = await sample(a); evidence.oneRenderedThreeSocketsHigh = high;
    evidence.performanceTarget = { pass: meetsTarget([{ scenario: 'normal', fps: high.fps, callbacks: high.callbacks, raf: { p95: high.p95Ms }, windowMs: high.windowMs, buffer: high.drawingBuffer, gl: String(high.gpu) }]), target: '1920x1080, >=58 callbacks/s and p95 <=20ms, nominal 15s / actual measured window', note: 'Functional PASS is not a performance PASS; locked/remote desktop and headless are not physical-display acceptance.' };
    await writeFile(info.outputPath('one-renderer.json'), JSON.stringify(evidence, null, 2));
    await a.screenshot({ path: info.outputPath('1080p-high-campus.png') });
    await a.evaluate(() => document.exitPointerLock());
    await a.getByRole('button', { name: 'Cài đặt', exact: true }).click(); await a.getByLabel('Chất lượng hình ảnh').selectOption('low');
    await a.getByRole('button', { name: 'Xong rồi' }).click(); await a.getByRole('button', { name: 'Tiếp tục · Bật điều khiển chuột' }).click();
    await a.waitForTimeout(2000); await startSample(a); await a.waitForTimeout(15000); evidence.oneRenderedThreeSocketsLow = await sample(a);
    await writeFile(info.outputPath('one-renderer.json'), JSON.stringify(evidence, null, 2));
    await a.evaluate(() => document.exitPointerLock()); await a.getByRole('button', { name: 'Rời phòng', exact: true }).click();
    await a.getByRole('button', { name: 'Rời lượt chơi', exact: true }).click();
    for (const peer of peers.splice(0)) await peer.room.leave();
    expect(view.errors).toEqual([]);
    if (process.env.CAMPUS_HARDWARE === '1') expect(String(high.gpu)).toContain('NVIDIA');
    if (process.env.CAMPUS_REQUIRE_60FPS === '1') expect((evidence.performanceTarget as { pass: boolean }).pass, 'Measured performance target, separate from functional checks').toBe(true);
  } finally {
    for (const peer of peers) if (peer.room.connection.isOpen) await peer.room.leave();
    for (const ctx of contexts) await ctx.close();
  }
});

// An independent test: resource/performance assertions can never short-circuit this coverage.
test('four isolated rendered contexts: distinct identities, actual movement and independent room', async ({ browser }, info) => {
  test.setTimeout(600000);
  // Functional fallback is explicitly labelled; never mix this with 1080p acceptance.
  const constrained = process.env.CAMPUS_FUNCTIONAL_SMALL === '1';
  const viewport = constrained ? { width: 1100, height: 720 } : { width: 1920, height: 1080 };
  const contexts = [], pages: Page[] = [], peers: TestClient[] = [];
  const evidence: Record<string, unknown> = {};
  try {
    const ctx = await browser.newContext({ viewport }); contexts.push(ctx);
    if (constrained) await ctx.addInitScript(() => localStorage.setItem('campus-settings', JSON.stringify({ quality: 'low' })));
    const a = await ctx.newPage(); pages.push(a); await instrument(a);
    const view = observe(a); await enter(a, 'Trình duyệt 1');
    await a.getByRole('button', { name: '☷ Cài đặt', exact: true }).click();
    await a.getByRole('slider', { name: 'Độ nhạy chuột' }).fill('1.5'); await a.getByRole('button', { name: 'Xong rồi' }).click();
    const fourCode = await a.locator('#invite-code').innerText(); const views = [view];
    for (let i = 1; i < 4; i++) {
      const ctx = await browser.newContext({ viewport }); contexts.push(ctx);
      if (constrained) await ctx.addInitScript(() => localStorage.setItem('campus-settings', JSON.stringify({ quality: 'low' })));
      const p = await ctx.newPage(); pages.push(p); await instrument(p); views.push(observe(p));
    }
    for (let i = 1; i < 4; i++) await enter(pages[i]!, `Trình duyệt ${i + 1}`, fourCode);
    // localStorage isolation and four separate identities.
    if (constrained) expect(await pages[1]!.evaluate(() => JSON.parse(localStorage.getItem('campus-settings')!).sensitivity)).toBeUndefined();
    else expect(await pages[1]!.evaluate(() => localStorage.getItem('campus-settings'))).toBeNull();
    for (const p of pages) { await p.bringToFront(); await p.getByRole('button', { name: 'Mình sẵn sàng' }).click(); }
    await a.bringToFront();
    await a.getByRole('button', { name: 'Cùng vào sân trường' }).click();
    const moves: { id: string; start: Vec3; end: Vec3 }[] = [];
    for (let i = 0; i < 4; i++) {
      const p = pages[i]!, v = views[i]!; await p.bringToFront();
      // Chromium enforces a short pointer-lock cooldown after another window releases it.
      await p.waitForTimeout(1200);
      await p.getByRole('button', { name: 'Vào sân · Bật điều khiển chuột' }).click();
      if (!await p.evaluate(() => !!document.pointerLockElement)) {
        await p.waitForTimeout(1500);
        await p.getByRole('button', { name: /(?:Vào sân|Tiếp tục) · Bật điều khiển chuột/ }).click();
      }
      await expect.poll(() => p.evaluate(() => !!document.pointerLockElement)).toBe(true);
      const start = { ...v.snapshot!.players.find(x => x.id === v.welcome!.playerId)!.position };
      await p.keyboard.press('KeyS', { delay: 1000 });
      await expect.poll(() => v.snapshot!.players.find(x => x.id === v.welcome!.playerId)!.position.z).toBeGreaterThan(start.z + .4);
      moves.push({ id: v.welcome!.playerId, start, end: v.snapshot!.players.find(x => x.id === v.welcome!.playerId)!.position });
      await writeFile(info.outputPath('four-movement.json'), JSON.stringify(moves, null, 2));
      await p.evaluate(() => document.exitPointerLock());
    }
    expect(new Set(moves.map(m => m.id)).size).toBe(4);
    const independent = await TestClient.create(browserEndpoint, 'Phòng riêng'); peers.push(independent);
    expect(independent.snapshot.players).toHaveLength(1); expect(independent.snapshot.phase).toBe('lobby');
    expect(independent.snapshot.players.some(p => moves.some(m => m.id === p.id))).toBe(false);
    evidence.fourBrowserMovement = moves;
    await Promise.all(pages.map(startSample)); await a.waitForTimeout(15000); evidence.fourRenderedHigh = await Promise.all(pages.map(sample));
    for (let i = 0; i < 4; i++) { expect(views[i]!.errors).toEqual([]); await pages[i]!.screenshot({ path: info.outputPath(`four-context-${i + 1}.png`) }); }
    evidence.snapshotWire = views.map(v => ({ frames: v.frames, meanBytes: v.bytes / v.frames, errors: v.errors }));
    evidence.environment = { constrained, viewport, browserVersion: browser.version(), headed: process.env.CAMPUS_HEADED === '1', angle: process.env.CAMPUS_ANGLE ?? 'gl', note: 'four rendered contexts share one Chromium process tree and one GPU; measurements include paused overlays; not four physical computers' };
    await writeFile(info.outputPath('hardware-four-browser.json'), JSON.stringify(evidence, null, 2));
  } finally {
    for (const peer of peers) if (peer.room.connection.isOpen) await peer.room.leave();
    for (const p of pages) if (!p.isClosed()) await p.evaluate(() => window.dispatchEvent(new Event('pagehide'))).catch(() => {});
    for (const ctx of contexts) await ctx.close();
  }
});
