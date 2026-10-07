import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createServer } from 'node:http';
import { createCampusServer } from '../../apps/server/src/server.js';
import { until } from '../helpers/client.js';
const run = promisify(execFile);
const script = resolve('tools/cloudflare.mjs');
const helperPath = resolve('tools/cloudflare-runtime.mjs');
const { originReady, superviseChild, verifyIdentity } = await import(helperPath);

it('operator prepare/status are offline, emit Unix-only ingress, and refuse unsafe directories and unrelated PIDs', async () => {
  expect(existsSync(script), 'reviewable operator entrypoint exists').toBe(true);
  const dir = await mkdtemp(resolve('.superpowers/cfo-'));
  try {
    const prepared = JSON.parse((await run(process.execPath, [script, 'prepare', dir])).stdout);
    expect(prepared.publicTunnelStarted).toBe(false);
    const config = JSON.parse(await readFile(join(dir, 'cloudflared.json'), 'utf8'));
    expect(config.ingress).toEqual([{ service: `unix:${dir}/origin.sock` }]);
    expect(Object.keys(config)).toEqual(['ingress']);
    const status = JSON.parse((await run(process.execPath, [script, 'status', dir])).stdout);
    expect(status.running).toBe(false);
    await writeFile(join(dir, 'tunnel-process.json'), JSON.stringify({ pid: process.pid, start: 'wrong-birth-time' }), { mode: 0o600 });
    await expect(run(process.execPath, [script, 'stop', dir])).rejects.toThrow('Refusing mismatched PID identity');
    expect(process.kill(process.pid, 0)).toBe(true);
    await expect(run(process.execPath, [script, 'tunnel', dir])).rejects.toThrow();
    await chmod(dir, 0o755);
    await expect(run(process.execPath, [script, 'prepare', dir])).rejects.toThrow();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it('operator readiness accepts configured capacity from the real protected Unix origin', async () => {
  const dir = await mkdtemp(resolve('.superpowers/cfo-'));
  const host = await createCampusServer(0, '127.0.0.1', { maxRooms: 7 }, { cloudflareSocketDir: dir });
  try { await expect(originReady(join(dir, 'origin.sock'))).resolves.toBeUndefined(); }
  finally { await host.close(); await rm(dir, { recursive: true, force: true }); }
});

it('operator readiness refuses invalid capacities and nonready or unsuccessful responses on a live Unix socket', async () => {
  const dir = await mkdtemp(resolve('.superpowers/cfo-'));
  let status = 200, body: unknown;
  const http = createServer((_req, res) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); });
  const socket = join(dir, 'origin.sock');
  await new Promise<void>(resolve => http.listen(socket, resolve));
  try {
    for (const capacity of [0, -1, 1.5, '7', null, undefined, Number.MAX_SAFE_INTEGER + 1]) {
      body = { status: 'ready', capacity };
      await expect(originReady(socket)).rejects.toThrow(/not ready/);
    }
    body = { status: 'draining', capacity: 7 };
    await expect(originReady(socket)).rejects.toThrow(/not ready/);
    body = { status: 'ready', capacity: 7 }; status = 503;
    await expect(originReady(socket)).rejects.toThrow(/not ready/);
  } finally { await new Promise<void>(resolve => http.close(() => resolve())); await rm(dir, { recursive: true, force: true }); }
});

it('failed real spawn settles once, closes the record FD, removes its owned record and signal handlers', async () => {
  const dir = await mkdtemp(resolve('.superpowers/cfo-'));
  const state = join(dir, 'tunnel-process.json');
  // Isolate the legacy unhandled rejection so RED reports observable cleanup
  // failures rather than crashing Vitest. No fake cloudflared or public transport.
  const source = `
    import { readdir, readlink } from 'node:fs/promises';
    import { existsSync } from 'node:fs';
    const { superviseChild } = await import(${JSON.stringify(helperPath)});
    const state = ${JSON.stringify(state)};
    const before = ['SIGINT', 'SIGTERM'].map(s => process.listenerCount(s));
    let code;
    try { await superviseChild(${JSON.stringify(join(dir, 'nonexistent'))}, [], {}, state); }
    catch (error) { code = error.code; }
    await new Promise(r => setImmediate(r));
    const targets = await Promise.all((await readdir('/proc/self/fd')).map(fd => readlink('/proc/self/fd/' + fd).catch(() => '')));
    console.log(JSON.stringify({code, recordExists: existsSync(state), recordFds: targets.filter(t => t.startsWith(state)).length,
      listenersRestored: JSON.stringify(before) === JSON.stringify(['SIGINT', 'SIGTERM'].map(s => process.listenerCount(s))) }));
  `;
  try {
    const result = await run(process.execPath, ['--unhandled-rejections=warn', '--input-type=module', '-e', source]);
    expect(JSON.parse(result.stdout)).toEqual({ code: 'ENOENT', recordExists: false, recordFds: 0, listenersRestored: true });
    expect(result.stderr).toBe('');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it('a supervised local child is recognized through a symlinked executable parent and cleans on SIGTERM', async () => {
  const dir = await mkdtemp(resolve('.superpowers/cfo-'));
  const state = join(dir, 'tunnel-process.json');
  const alias = join(dir, 'checkout-tools');
  const before = ['SIGINT', 'SIGTERM'].map(s => process.listenerCount(s));
  await symlink(resolve(process.execPath, '..'), alias);
  const binary = join(alias, process.execPath.split('/').at(-1)!);
  const done = superviseChild(binary, ['-e', 'setInterval(() => {}, 1000)', '--', '--no-autoupdate', dir], {}, state);
  let saved: { pid: number; start: string; exe: string } | undefined;
  try {
    await until(() => existsSync(state));
    for (let i = 0; i < 100 && !saved; i++) {
      try { saved = JSON.parse(await readFile(state, 'utf8')); } catch { await new Promise(r => setTimeout(r, 10)); }
    }
    expect(saved).toBeDefined();
    await expect(verifyIdentity(saved, binary, dir)).resolves.toMatchObject({ pid: saved!.pid });
  } finally {
    if (saved) process.kill(saved.pid, 'SIGTERM');
    await done;
    await rm(dir, { recursive: true, force: true });
  }
  expect(existsSync(state)).toBe(false);
  expect(['SIGINT', 'SIGTERM'].map(s => process.listenerCount(s))).toEqual(before);
});
