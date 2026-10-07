import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
const run = promisify(execFile);
const staging = await mkdtemp(resolve('artifacts/runtime-check-'));
let child: ReturnType<typeof spawn> | undefined;
try {
  const archive = resolve(process.argv[2] ?? 'artifacts/campus-together-0.1.0.tar.gz');
  const sha256 = createHash('sha256').update(await readFile(archive)).digest('hex');
  const expected = (await readFile(`${archive}.sha256`, 'utf8')).split(/\s/)[0];
  if (sha256 !== expected) throw new Error('Archive checksum mismatch');
  await run('tar', ['-xzf', archive, '-C', staging]);
  const integrity = await run(process.execPath, ['tools/verify-runtime.mjs'], { cwd: staging });
  const install = await run('npm', ['ci', '--omit=dev'], { cwd: staging, timeout: 120000 });
  const probe = createServer(); await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address(); if (!address || typeof address === 'string') throw new Error('No probe port');
  const port = address.port; await new Promise<void>(resolve => probe.close(() => resolve()));
  child = spawn(process.execPath, ['apps/server/dist/index.js'], { cwd: staging, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  const logs: string[] = []; child.stdout!.on('data', b => logs.push(String(b))); child.stderr!.on('data', b => logs.push(String(b)));
  const deadline = Date.now() + 10000;
  while (!logs.some(s => s.includes('Campus Together:'))) { if (Date.now() > deadline || child.exitCode !== null) throw new Error(`Runtime did not start: ${logs.join('')}`); await new Promise(r => setTimeout(r, 50)); }
  const smoke = await run('npx', ['tsx', 'tools/runtime-smoke.ts', `http://127.0.0.1:${port}`], { timeout: 30000 });
  const browser = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? await run(process.execPath, ['tools/runtime-browser-smoke.mjs', `http://127.0.0.1:${port}`], { timeout: 120000 }) : null;
  const report = { archive, sha256, integrity: JSON.parse(integrity.stdout), install: install.stdout, smoke: smoke.stdout, browser: browser ? JSON.parse(browser.stdout) : 'not run (set PLAYWRIGHT_CHROMIUM_EXECUTABLE)', runtime: logs, node: process.version };
  await writeFile('artifacts/package-smoke.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally {
  if (child && child.exitCode === null) { child.kill('SIGTERM'); const timer = setTimeout(() => child?.kill('SIGKILL'), 10000); await new Promise<void>(resolve => child!.once('exit', () => resolve())); clearTimeout(timer); }
  await rm(staging, { recursive: true, force: true });
}
