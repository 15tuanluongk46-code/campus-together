// Bounded production-frame diagnostic: actual keys, one renderer + three sockets.
import { chromium } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { TestClient, sleep } from '../tests/helpers/client.js';
const output = '.superpowers/sdd/play-flow/performance-moving.json';
const endpoint = 'http://127.0.0.1:2867';
try { await fetch(endpoint); throw new Error('Test port occupied'); } catch (e) { if (!(e instanceof TypeError)) throw e; }
const server = spawn(process.execPath, ['apps/server/dist/index.js'], { env: { ...process.env, HOST: '127.0.0.1', PORT: '2867' }, stdio: 'ignore' });
const peers: TestClient[] = []; let browser;
const gpu = () => { try { return execFileSync('nvidia-smi', ['--query-gpu=timestamp,name,utilization.gpu,memory.used', '--format=csv,noheader'], { encoding: 'utf8' }).trim(); } catch { return 'unavailable'; } };
const report: any = { kind: 'production moving courtyard, normal controls; not human/display acceptance', samples: [], gpu: [gpu()], errors: [], warnings: [] };
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${endpoint}/health`)).ok) break; } catch {} await sleep(100); }
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, args: ['--use-gl=angle', '--use-angle=gl'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', e => report.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); if (m.type() === 'warning') report.warnings.push(m.text()); });
  await page.addInitScript('window.__name = fn => fn');
  await page.addInitScript(() => {
    const w = window as any; w.meter = { active: false, rows: [], prev: 0, start: 0, end: 0, callbacks: 0 };
    requestAnimationFrame(function tick(t) { const m = w.meter; if (m.active) { if (m.prev) m.rows.push(t - m.prev); m.callbacks++; m.prev = t; } requestAnimationFrame(tick); });
  });
  await page.goto(endpoint); await page.waitForLoadState('networkidle');
  await page.getByLabel('Bạn tên là gì?').fill('Đo lúc di chuyển'); await page.getByRole('button', { name: /Tạo phòng cùng bạn/ }).click();
  const code = await page.locator('#invite-code').innerText();
  for (let i = 0; i < 3; i++) { const p = await TestClient.join(endpoint, code); peers.push(p); await p.act({ type: 'ready', ready: true }); }
  await page.getByRole('button', { name: 'Mình sẵn sàng' }).click(); await page.getByRole('button', { name: 'Cùng vào sân trường' }).click();
  await page.getByRole('button', { name: 'Vào sân · Bật điều khiển chuột' }).click();
  for (const quality of ['high', 'low']) {
    if (quality === 'low') {
      await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Cài đặt', exact: true }).click();
      await page.getByLabel('Chất lượng hình ảnh').selectOption('low'); await page.getByRole('button', { name: 'Xong rồi' }).click();
      await page.getByRole('button', { name: 'Tiếp tục · Bật điều khiển chuột' }).click();
    }
    await sleep(2000);
    await page.evaluate(() => { const m = (window as any).meter; Object.assign(m, { active: true, rows: [], prev: 0, callbacks: 0, start: performance.now(), end: 0 }); setTimeout(() => { m.active = false; m.end = performance.now(); }, 15000); });
    const began = Date.now(); let i = 0;
    while (Date.now() - began < 15000) { await page.keyboard.press(i++ % 2 ? 'KeyW' : 'KeyS', { delay: 600 }); await sleep(120); }
    report.gpu.push(gpu());
    const data = await page.evaluate(() => {
      const m = (window as any).meter; m.active = false;
      const gl = document.querySelector<HTMLCanvasElement>('#campus')!.getContext('webgl2')!, ext = gl.getExtension('WEBGL_debug_renderer_info');
      return { ...m, end: m.end || performance.now(), renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight], visibility: document.visibilityState, pointerLock: !!document.pointerLockElement, glError: gl.getError() };
    });
    const sorted = [...data.rows].sort((a, b) => a - b);
    report.samples.push({ quality, fps: data.callbacks * 1000 / (data.end - data.start), p95: sorted[Math.floor(sorted.length * .95)], ...data });
  }
  report.browser = browser.version();
} finally {
  for (const p of peers) if (p.room.connection.isOpen) await p.room.leave();
  await browser?.close(); server.kill('SIGTERM');
  await writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, samples: report.samples.map(({ rows, ...s }: any) => s), errors: report.errors, gpu: report.gpu }));
}
