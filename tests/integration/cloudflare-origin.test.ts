import { afterEach, expect, it, vi } from 'vitest';
import { chmod, lstat, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { request, type OutgoingHttpHeaders } from 'node:http';
import { join, resolve } from 'node:path';
import WebSocket from 'ws';
import { createServer as createNetServer } from 'node:net';
import { matchMaker } from '@colyseus/core';
import { CollisionWorld } from '@campus/shared';
import { createCampusServer } from '../../apps/server/src/server.js';
import { sleep, until } from '../helpers/client.js';

let host: Awaited<ReturnType<typeof createCampusServer>> | undefined;
let dir: string;
const sockets: WebSocket[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const ws of sockets.splice(0)) ws.terminate();
  await host?.close(); host = undefined;
  if (dir) await rm(dir, { recursive: true, force: true });
});
const body = JSON.stringify({ name: 'Tunnel', protocol: 1, mode: 'solo' });
async function boot(limits = {}) {
  dir = await mkdtemp(resolve('.superpowers/cf-test-'));
  host = await createCampusServer(0, '127.0.0.1', limits, { cloudflareSocketDir: dir });
  expect(existsSync(join(dir, 'origin.sock')), 'opt-in creates the dedicated origin socket').toBe(true);
}
function send(path = '/matchmake/create/campus', ip: string | string[] | null = '203.0.113.1', extra: OutgoingHttpHeaders = {}, tcp = false, payload = body) {
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    const req = request({ ...(tcp ? { host: '127.0.0.1', port: host!.port } : { socketPath: join(dir, 'origin.sock') }),
      path, method: path.startsWith('/matchmake/') ? 'POST' : 'GET', headers: {
        'content-type': 'application/json', ...(ip === null ? {} : { 'cf-connecting-ip': ip }), ...extra,
      } }, res => {
      let text = ''; res.on('data', b => { text += b; }); res.on('end', () => resolve({ status: res.statusCode!, text }));
    });
    req.on('error', reject); req.end(path.startsWith('/matchmake/') ? payload : undefined);
  });
}
function upgrade(path: string, ip?: string | string[], tcp = false, extra: OutgoingHttpHeaders = {}) {
  return new Promise<{ status: number; ws: WebSocket; messages: Buffer[] }>((resolve, reject) => {
    const messages: Buffer[] = [];
    const ws = new WebSocket(tcp ? `ws://127.0.0.1:${host!.port}${path}` : `ws+unix://${join(dir, 'origin.sock')}:${path}`, {
      headers: { ...(ip === undefined ? {} : { 'cf-connecting-ip': ip }), ...extra },
    });
    sockets.push(ws);
    ws.on('message', data => messages.push(Buffer.from(data as Buffer)));
    ws.on('error', reject);
    ws.once('unexpected-response', (_req, res) => { res.resume(); resolve({ status: res.statusCode!, ws, messages }); });
    ws.once('open', () => resolve({ status: 101, ws, messages }));
  });
}

it('socket origin keeps six-token per-visitor budgets; XFF/auth spoofing grants nothing; default TCP stays peer-only', async () => {
  await boot();
  expect((await lstat(dir)).mode & 0o777).toBe(0o700);
  expect((await lstat(join(dir, 'origin.sock'))).mode & 0o777).toBe(0o600);
  for (let i = 0; i < 6; i++) expect((await send(i % 2 ? '/matchmake/joinOrCreate/campus' : undefined)).status).toBe(200);
  expect((await send(undefined, '203.0.113.1', { 'x-forwarded-for': '198.51.100.2', authorization: 'Bearer client-spoof', 'x-campus-trusted-ip': '198.51.100.3' })).status).toBe(429);
  expect((await send(undefined, '203.0.113.2')).status).toBe(200);
  for (let i = 0; i < 6; i++) expect((await send(undefined, `198.51.100.${i + 1}`, { 'x-forwarded-for': `192.0.2.${i}` }, true)).status).toBe(200);
  expect((await send(undefined, '8.8.8.8', {}, true)).status).toBe(429);
});

it('missing, duplicate and malformed Cloudflare identity fails closed on HTTP and WS without charging a real visitor', async () => {
  await boot({ createBurst: 1 });
  for (const ip of [undefined, '', 'unknown', '203.0.113.1, 203.0.113.2', '203.0.113.1:12', '[2001:db8::1]', 'fe80::1%eth0', ['203.0.113.1', '203.0.113.1']]) {
    expect((await send(undefined, ip ?? null, { 'x-forwarded-for': '203.0.113.2' })).status, String(ip)).toBe(400);
    expect((await upgrade('/process/room?sessionId=invalid', ip)).status, String(ip)).toBe(400);
  }
  expect((await send('/health', null)).status).toBe(400);
  expect((await send()).status).toBe(200);
  expect(JSON.parse((await send('/ready')).text)).toMatchObject({ rooms: 1 });
});

it('canonical IPv6 and IPv4-mapped aliases share budgets and trusted identities remain bounded', async () => {
  await boot({ createBurst: 1, maxIps: 2 });
  expect((await send(undefined, '2001:db8::1')).status).toBe(200);
  expect((await send(undefined, '2001:0DB8:0:0:0:0:0:1')).status).toBe(429);
  expect((await send(undefined, '::ffff:192.0.2.1')).status).toBe(200);
  expect((await send(undefined, '192.0.2.1')).status).toBe(429);
  expect((await send(undefined, '192.0.2.2')).status).toBe(503);
});

it('trusted allocation charges malformed bodies/aliases and enforces the shared 32-room cap before initialization', async () => {
  await boot();
  expect((await send(undefined, '192.0.2.1', {}, false, '{bad')).status).toBe(400);
  for (let i = 0; i < 5; i++) expect((await send('/matchmake/create/campus?alias=query', '192.0.2.1')).status).toBe(200);
  expect((await send(undefined, '192.0.2.1')).status).toBe(429);
  for (let i = 0; i < 27; i++) expect((await send(undefined, `198.51.100.${i + 1}`)).status).toBe(200);
  const init = vi.spyOn(CollisionWorld, 'create');
  expect((await send(undefined, '203.0.113.222')).status).toBe(503);
  expect(init).not.toHaveBeenCalled();
  expect(JSON.parse((await send('/ready')).text)).toMatchObject({ rooms: 32, capacity: 32 });
});

it('trusted channel only serves game files, health and matchmaking; unknown HTTP and WS routes are denied', async () => {
  await boot();
  for (const path of ['/', '/index.html', '/favicon.svg', '/health', '/ready']) expect((await send(path)).status, path).toBe(200);
  for (const path of ['/package.json', '/.env', '/docs/spec.md', '/tools/cloudflared-release.json', '/json/version', '/metrics', '/admin', '/__healthcheck', '/assets/../../package.json', '/%2eenv']) {
    expect((await send(path)).status, path).toBe(404);
    expect((await upgrade(path, '203.0.113.1')).status, path).toBe(404);
  }
  expect((await upgrade('/health', '203.0.113.1')).status).toBe(404);
});

it('real room WebSocket handshake, messages and reconnect work via Unix origin even with allocation exhausted', async () => {
  await boot({ createBurst: 1 });
  const reservation = JSON.parse((await send()).text);
  const path = `/${reservation.processId}/${reservation.roomId}?sessionId=${reservation.sessionId}`;
  const connected = await upgrade(path, '203.0.113.1', false, { 'x-forwarded-for': 'spoof' });
  expect(connected.status).toBe(101);
  await until(() => connected.messages.some(data => data[0] === 10));
  const message = connected.messages.find(data => data[0] === 10)!;
  // Colyseus JOIN_ROOM: byte 10, token length, token UTF-8. Acknowledge to activate the seat.
  const token = message!.subarray(2, 2 + message![1]!).toString();
  connected.ws.send(Buffer.from([10]));
  await until(() => matchMaker.getLocalRoomById(reservation.roomId)!.clients.length === 1);
  expect((await send()).status).toBe(429);
  connected.ws.close(4010);
  await until(() => matchMaker.getLocalRoomById(reservation.roomId)!.clients.length === 0);
  await sleep(30);
  const reconnect = await send(`/matchmake/reconnect/${reservation.roomId}`, '203.0.113.1', {}, false, JSON.stringify({ reconnectionToken: token }));
  expect(reconnect.status).toBe(200);
  const restored = JSON.parse(reconnect.text);
  expect((await upgrade(`/${restored.processId}/${restored.roomId}?sessionId=${restored.sessionId}&reconnectionToken=${token}`, '203.0.113.1')).status).toBe(101);
});

it('default TCP strips forwarding identity from WebSocket auth as well as HTTP', async () => {
  await boot();
  const reservation = JSON.parse((await send(undefined, '203.0.113.1', {}, true)).text);
  const room = matchMaker.getLocalRoomById(reservation.roomId)!;
  const onJoin = vi.spyOn(room, '_onJoin');
  expect((await upgrade(`/${reservation.processId}/${reservation.roomId}?sessionId=${reservation.sessionId}`, 'not-an-ip', true,
    { 'x-forwarded-for': '198.51.100.9', 'x-real-ip': '192.0.2.1' })).status).toBe(101);
  await until(() => onJoin.mock.calls.length === 1);
  const ctx = onJoin.mock.calls[0]![1] as { ip: string; headers: Headers };
  expect(ctx.ip).toBe('127.0.0.1');
  expect(ctx.headers.get('cf-connecting-ip')).toBeNull();
});

it('shutdown drains both channels, closes WS and unlinks only the owned socket; start can reuse the directory', async () => {
  await boot();
  const reservation = JSON.parse((await send()).text);
  const ws = await upgrade(`/${reservation.processId}/${reservation.roomId}?sessionId=${reservation.sessionId}`, '203.0.113.1');
  const room = matchMaker.getLocalRoomById(reservation.roomId)!;
  const dispose = room.onDispose!.bind(room);
  let release!: () => void;
  const barrier = new Promise<void>(r => { release = r; });
  vi.spyOn(room, 'onDispose').mockImplementation(async () => { await barrier; dispose(); });
  const closing = host!.close();
  try {
    expect((await send('/ready')).status).toBe(503);
    expect((await send()).status).toBe(503);
    expect((await send('/ready', undefined, {}, true)).status).toBe(503);
    expect((await upgrade(`/${reservation.processId}/${reservation.roomId}?sessionId=${reservation.sessionId}`, '203.0.113.1')).status).toBe(503);
  } finally { release(); await closing; }
  expect(ws.ws.readyState).not.toBe(WebSocket.OPEN);
  expect(existsSync(join(dir, 'origin.sock'))).toBe(false);
  host = await createCampusServer(0, '127.0.0.1', {}, { cloudflareSocketDir: dir });
  expect((await send('/health')).status).toBe(200);
});

it('Unix init failure frees capacity and concurrent requests across channels cannot exceed the shared cap', async () => {
  await boot({ maxRooms: 2 });
  vi.spyOn(CollisionWorld, 'create').mockRejectedValueOnce(new Error('injected Unix init failure'));
  expect((await send()).status).not.toBe(200);
  expect(JSON.parse((await send('/ready')).text)).toMatchObject({ rooms: 0 });
  vi.restoreAllMocks();
  const original = CollisionWorld.create.bind(CollisionWorld);
  let release!: () => void;
  const barrier = new Promise<void>(r => { release = r; });
  const init = vi.spyOn(CollisionWorld, 'create').mockImplementation(async () => { await barrier; return original(); });
  const requests = Array.from({ length: 8 }, (_, i) => send(undefined, `198.51.100.${i + 1}`, {}, i % 2 === 0));
  try { await until(() => init.mock.calls.length >= 2); await sleep(30); expect(init).toHaveBeenCalledTimes(2); }
  finally { release(); }
  const responses = await Promise.all(requests);
  expect(responses.filter(r => r.status === 200)).toHaveLength(2);
  expect(responses.filter(r => r.status === 503)).toHaveLength(6);
});

it('TCP bind failure rejects promptly and leaves no trusted origin socket or framework lifecycle behind', async () => {
  dir = await mkdtemp(resolve('.superpowers/cf-test-'));
  const busy = createNetServer();
  await new Promise<void>(resolve => busy.listen(0, '127.0.0.1', resolve));
  const address = busy.address(); if (!address || typeof address === 'string') throw new Error('no port');
  try {
    await expect(createCampusServer(address.port, '127.0.0.1', {}, { cloudflareSocketDir: dir })).rejects.toThrow(/EADDRINUSE/);
    expect(existsSync(join(dir, 'origin.sock'))).toBe(false);
    host = await createCampusServer(0, '127.0.0.1', {}, { cloudflareSocketDir: dir });
    expect((await send('/health')).status).toBe(200);
  } finally { await new Promise<void>(resolve => busy.close(() => resolve())); }
});

it('unsafe, symlinked or occupied socket locations fail before listeners start without deleting user files', async () => {
  dir = await mkdtemp(resolve('.superpowers/cf-test-'));
  await chmod(dir, 0o755);
  await expect(createCampusServer(0, '127.0.0.1', {}, { cloudflareSocketDir: dir })).rejects.toThrow(/0700/);
  await chmod(dir, 0o700);
  await symlink(dir, join(dir, 'alias'));
  await expect(createCampusServer(0, '127.0.0.1', {}, { cloudflareSocketDir: join(dir, 'alias') })).rejects.toThrow(/symlink|canonical/);
  await writeFile(join(dir, 'origin.sock'), 'keep');
  await expect(createCampusServer(0, '127.0.0.1', {}, { cloudflareSocketDir: dir })).rejects.toThrow(/exists/);
  expect(await readFile(join(dir, 'origin.sock'), 'utf8')).toBe('keep');
});
