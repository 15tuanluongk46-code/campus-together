// Standalone, trace/video/screenshot-free sequential GPU/frame-pacing investigation.
// Run: npx tsx tests/performance/run.ts [label] [scenario,scenario,...]
import { chromium, type Page } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { TestClient, sleep } from '../helpers/client.js';
import { meetsTarget } from './verdict.js';
const root = process.cwd();
const label = process.argv[2] ?? 'baseline';
const scenarios = (process.argv[3] ?? 'normal,probed,normal').split(',');
const duration = Number(process.env.PERF_MS ?? 15000);
const warmup = Number(process.env.PERF_WARMUP ?? 4000);
const output = `${root}/.superpowers/sdd/campus/performance/${label}`;
await mkdir(output, { recursive: true });
const children: ReturnType<typeof spawn>[] = [];
const serverLogs: string[] = [];
async function server(args: string[], url: string) {
  try { await fetch(url); throw new Error(`Port already occupied: ${url}`); } catch (e) { if (!(e instanceof TypeError)) throw e; }
  const child = spawn(process.execPath, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }); children.push(child);
  child.stdout!.on('data', b => serverLogs.push(String(b))); child.stderr!.on('data', b => serverLogs.push(String(b)));
  for (let n = 0; n < 150; n++) { try { if ((await fetch(url)).ok) return; } catch {} await sleep(200); }
  throw new Error(`Server not ready: ${url}`);
}
function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b), total = values.reduce((a, b) => a + b, 0);
  return { n: values.length, mean: total / values.length, p50: sorted[Math.floor(sorted.length * .5)], p95: sorted[Math.floor(sorted.length * .95)], p99: sorted[Math.floor(sorted.length * .99)], max: sorted.at(-1) };
}
function gpu() {
  try { return execFileSync('nvidia-smi', ['--query-gpu=timestamp,utilization.gpu,utilization.memory,memory.used,power.draw,clocks.gr,clocks.mem', '--format=csv,noheader,nounits'], { encoding: 'utf8' }).trim(); } catch { return 'unavailable'; }
}
function desktop() {
  try { return execFileSync('loginctl', ['show-session', process.env.XDG_SESSION_ID ?? 'self', '-p', 'Remote', '-p', 'Type', '-p', 'LockedHint', '-p', 'IdleHint'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return 'unknown; set XDG_SESSION_ID for the measured desktop'; }
}
async function meter(page: Page) {
  // tsx preserves callback names using this helper; init scripts run in another realm.
  await page.addInitScript('window.__name = (fn) => fn;');
  await page.addInitScript(() => {
    const w = window as any;
    w.frameMeter = { rows: [] as number[], wall: [] as number[], callbacks: 0, enabled: false, previous: 0, previousWall: 0, started: 0, ended: 0, start(ms: number) { this.rows = []; this.wall = []; this.callbacks = 0; this.previous = 0; this.previousWall = 0; this.enabled = true; this.started = performance.now(); this.ended = 0; setTimeout(() => { this.enabled = false; this.ended = performance.now(); w.perfProbe?.endWindow(); }, ms); } };
    function frame(now: number) {
      const m = w.frameMeter, wall = performance.now();
      if (m.enabled) { m.callbacks++; if (m.previous) { m.rows.push(now - m.previous); m.wall.push(wall - m.previousWall); } }
      m.previous = now; m.previousWall = wall; requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
}
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const peers: TestClient[] = [];
const report: any = { label, started: new Date().toISOString(), duration, warmup, trace: false, samples: [] };
try {
  await server(['apps/server/dist/index.js'], 'http://127.0.0.1:2567/health');
  const production = process.env.PERF_PRODUCTION === '1';
  report.production = production;
  if (!production) await server(['node_modules/vite/bin/vite.js', 'apps/client', '--host', '127.0.0.1'], 'http://127.0.0.1:5173');
  const headed = process.env.PERF_HEADLESS !== '1';
  const args = ['--ozone-platform=x11', '--use-gl=angle', '--use-angle=gl', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];
  if (process.env.PERF_UNCAPPED === '1') args.push('--disable-frame-rate-limit');
  browser = await chromium.launch({ headless: !headed, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? '/home/sss/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome', args });
  report.browser = browser.version(); report.headed = headed; report.args = args; report.gpuStart = gpu();
  report.desktop = desktop();
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage(); const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); await meter(page);
  const extraPages: Page[] = [];
  if (process.env.PERF_AA === '0' && !production) {
    // Test-only served-module ablation; production source is never edited.
    report.antialiasAblation = true;
    await page.route('**/src/scene.ts', async route => {
      const response = await route.fetch(); const source = await response.text();
      if (!source.includes('antialias: true')) throw new Error('Antialias ablation seam not found');
      await route.fulfill({ response, body: source.replace('antialias: true', 'antialias: false') });
    });
  }
  await page.goto(production ? 'http://127.0.0.1:2567' : 'http://127.0.0.1:5173'); await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: /Tạo phòng bạn bè/ }).waitFor();
  await page.waitForFunction(() => !(document.querySelector('[data-submit="create"]') as HTMLButtonElement)?.disabled, { timeout: 60000 });
  if (process.env.PERF_MINIMAL === '1') {
    report.minimal = true;
    await page.evaluate(async aa => { const path = '/@fs/home/sss/AI-Home/projects/campus-together/tests/performance/minimal.ts'; const mod = await import(/* @vite-ignore */ path); mod.install(aa); }, process.env.PERF_AA !== '0');
  } else {
  await page.getByLabel('Bạn tên là gì?').fill('Đo khung hình'); await page.getByRole('button', { name: /Tạo phòng bạn bè/ }).click();
  const code = await page.locator('#invite-code').innerText();
  for (let i = 0; i < 3; i++) {
    if (process.env.PERF_FOUR === '1') {
      const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
      const p = await context.newPage(); extraPages.push(p); await meter(p); p.on('pageerror', e => errors.push(e.message));
      await p.goto(`${production ? 'http://127.0.0.1:2567' : 'http://127.0.0.1:5173'}/?room=${code}`);
      await p.waitForLoadState('networkidle');
      await p.waitForFunction(() => (document.querySelector('[data-submit="join"]') as HTMLButtonElement)?.disabled === false);
      await p.getByLabel('Bạn tên là gì?').fill(`Bạn ${i}`); await p.getByRole('button', { name: 'Vào phòng', exact: true }).click();
      await p.getByRole('button', { name: 'Mình sẵn sàng' }).click();
    } else { const peer = await TestClient.join('ws://127.0.0.1:2567', code, `Bạn ${i}`); peers.push(peer); await peer.act({ type: 'ready', ready: true }); }
  }
  await page.bringToFront();
  await page.getByRole('button', { name: 'Mình sẵn sàng' }).click(); await page.getByRole('button', { name: 'Cùng vào sân trường' }).click();
  await page.getByRole('button', { name: 'Vào sân · Bật điều khiển chuột' }).click();
  for (const p of extraPages) { await p.bringToFront(); await sleep(1500); await p.getByRole('button', { name: 'Vào sân · Bật điều khiển chuột' }).click(); await p.evaluate(() => document.exitPointerLock()); }
  if (extraPages.length) { await page.bringToFront(); report.fourContexts = 'four 1080p renderers sharing one GPU; paused after sequential pointer-lock; no four-machine claim'; }
  }
  for (const scenario of scenarios) {
    if (scenario !== 'normal' && !report.minimal) await page.evaluate(async () => { const mod = await import(/* @vite-ignore */ '/@fs/' + 'home/sss/AI-Home/projects/campus-together/tests/performance/probe.ts'); await Promise.race([mod.install(), new Promise((_, reject) => setTimeout(() => reject(new Error('Probe did not attach to live scene')), 10000))]); });
    await page.evaluate(mode => { (window as any).perfProbe?.mode(mode === 'probed' || mode === 'timers' || mode === 'normal' ? 'normal' : mode); }, scenario);
    await sleep(warmup);
    const desktopStart = desktop(); const gpuSamples = [gpu()]; const monitor = setInterval(() => gpuSamples.push(gpu()), 1000);
    await page.evaluate(({ timers, duration }) => { (window as any).frameMeter.start(duration); (window as any).perfProbe?.start(timers); }, { timers: scenario === 'timers', duration });
    for (const p of extraPages) await p.evaluate(ms => (window as any).frameMeter.start(ms), duration);
    const start = performance.now(); await sleep(duration);
    const raw = await page.evaluate(() => {
      const w = window as any; w.frameMeter.enabled = false;
      const canvas = document.querySelector<HTMLCanvasElement>('#campus')!, gl = canvas.getContext('webgl2')!, ext = gl.getExtension('WEBGL_debug_renderer_info');
      return { raf: w.frameMeter.rows, wall: w.frameMeter.wall, callbacks: w.frameMeter.callbacks, windowMs: (w.frameMeter.ended || performance.now()) - w.frameMeter.started, probe: w.perfProbe?.stop(), gl: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), context: gl.getContextAttributes(), quality: JSON.parse(localStorage.getItem('campus-settings') ?? '{}').quality ?? 'high', buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight], viewport: [innerWidth, innerHeight], visibility: document.visibilityState, focus: document.hasFocus(), pointerLock: !!document.pointerLockElement };
    });
    clearInterval(monitor);
    const extra = [];
    for (const p of extraPages) extra.push(await p.evaluate(() => { const m = (window as any).frameMeter; const gl = document.querySelector<HTMLCanvasElement>('#campus')!.getContext('webgl2')!; const ext = gl.getExtension('WEBGL_debug_renderer_info'); return { callbacks: m.callbacks, windowMs: m.ended - m.started, raf: m.rows, buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight], gl: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), visible: document.visibilityState }; }));
    const { raf, wall, probe, ...metadata } = raw;
    const sample = { scenario, desktopStart, desktopEnd: desktop(), elapsed: performance.now() - start, ...metadata, raf: stats(raf), wall: stats(wall), fps: raw.callbacks * 1000 / raw.windowMs, intervalEquivalentFps: 1000 / stats(raf).mean, probe: probe ? { ...probe, ...Object.fromEntries(['cpu', 'render', 'gpu', 'calls', 'triangles', 'ui'].map(k => [k, stats(probe[k])])) } : null, extra: extra.map(s => ({ ...s, rawRaf: s.raf, raf: stats(s.raf), fps: s.callbacks * 1000 / s.windowMs })), gpuSamples, raw };
    report.samples.push(sample); await writeFile(`${output}/measurements.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ scenario, fps: sample.fps, raf: sample.raf, cpu: sample.probe?.cpu, render: sample.probe?.render, gpu: sample.probe?.gpu, errors }));
  }
  report.errors = errors; report.gpuEnd = gpu();
  report.target60 = meetsTarget(report.samples);
  report.desktopAcceptance = report.target60 && headed && !report.minimal && production && !report.args.includes('--disable-frame-rate-limit') && report.samples.every((s: any) => [s.desktopStart, s.desktopEnd].every(v => String(v).includes('LockedHint=no')));
  await writeFile(`${output}/measurements.json`, JSON.stringify(report, null, 2));
  console.log(`1080p60 ${report.target60 ? 'PASS' : 'FAIL'}; evidence ${output}/measurements.json`);
  if (process.env.PERF_ASSERT === '1' && !report.target60) process.exitCode = 1;
} finally {
  for (const peer of peers) if (peer.room.connection.isOpen) await peer.room.leave().catch(() => {});
  await browser?.close();
  for (const child of children.reverse()) { child.kill('SIGTERM'); await Promise.race([new Promise(r => child.once('exit', r)), sleep(5000)]); }
  await writeFile(`${output}/servers.log`, serverLogs.join(''));
}
