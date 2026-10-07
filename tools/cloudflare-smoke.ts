// Test-only local Unix-channel bridge. Never packaged and never publicly bound.
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer, request } from 'node:http';
import { connect } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
const run = promisify(execFile);
const runtime = resolve(process.argv[2]!);
const evidence = resolve('.superpowers/sdd/cloudflare');
const privateDir = await mkdtemp(resolve('.superpowers/cf-smoke-'));
const socketPath = join(privateDir, 'origin.sock');
const capacity = Number(process.env.CAMPUS_MAX_ROOMS ?? 32);
const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const address = probe.address(); if (!address || typeof address === 'string') throw new Error('port');
await new Promise<void>(resolve => probe.close(() => resolve()));
const child = spawn(process.execPath, ['apps/server/dist/index.js'], { cwd: runtime, stdio: ['ignore', 'pipe', 'pipe'],
  env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(address.port), CAMPUS_MAX_ROOMS: String(capacity), CAMPUS_CLOUDFLARE_SOCKET_DIR: privateDir } });
const exited = once(child, 'exit');
let logs = ''; child.stdout.on('data', b => { logs += b; }); child.stderr.on('data', b => { logs += b; });
const bridge = createServer((req, res) => {
  const upstream = request({ socketPath, path: req.url, method: req.method,
    headers: { ...req.headers, 'cf-connecting-ip': '203.0.113.240' } }, reply => {
      res.writeHead(reply.statusCode!, reply.headers); reply.pipe(res);
    });
  upstream.on('error', error => res.destroy(error)); req.pipe(upstream);
});
const connections = new Set<import('node:net').Socket>();
bridge.on('connection', s => { connections.add(s); s.once('close', () => connections.delete(s)); });
bridge.on('upgrade', (req, socket, head) => {
  const upstream = connect(socketPath, () => {
    const headers = { ...req.headers, 'cf-connecting-ip': '203.0.113.240' };
    upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy());
  socket.on('close', () => upstream.destroy());
});
try {
  const deadline = Date.now() + 10000;
  while (!logs.includes('Cloudflare origin:')) {
    if (Date.now() > deadline || child.exitCode !== null) throw new Error(`Runtime start failed: ${logs}`);
    await new Promise(r => setTimeout(r, 40));
  }
  const { originReady } = await import(pathToFileURL(join(runtime, 'tools/cloudflare-runtime.mjs')).href);
  await originReady(socketPath);
  bridge.listen(0, '127.0.0.1'); await once(bridge, 'listening');
  const front = bridge.address(); if (!front || typeof front === 'string') throw new Error('bridge port');
  const tcp = `http://127.0.0.1:${address.port}`, trusted = `http://127.0.0.1:${front.port}`;
  const direct = await run('npx', ['tsx', 'tools/runtime-smoke.ts', tcp], { timeout: 30000 });
  const unix = await run('npx', ['tsx', 'tools/runtime-smoke.ts', trusted], { timeout: 30000 });
  const browser = await run(process.execPath, ['tools/runtime-browser-smoke.mjs', trusted], { timeout: 120000,
    env: { ...process.env, CAMPUS_EVIDENCE_DIR: join(evidence, 'browser') } });
  const report = { runtime, tcp: JSON.parse(direct.stdout), trustedUnix: JSON.parse(unix.stdout),
    trustedBrowser: JSON.parse(browser.stdout), configuredCapacity: capacity, extractedOperatorOriginReady: true, publicTunnelStarted: false, logs };
  await writeFile(join(evidence, 'runtime-smoke.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  for (const socket of connections) socket.destroy(); bridge.close();
  if (child.exitCode === null) child.kill('SIGTERM');
  const timeout = setTimeout(() => child.kill('SIGKILL'), 10000);
  await exited; clearTimeout(timeout);
  await rm(privateDir, { recursive: true, force: true });
}
