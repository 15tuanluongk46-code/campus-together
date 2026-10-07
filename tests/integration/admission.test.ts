import { afterEach, expect, it, vi } from 'vitest';
import { Client } from '@colyseus/sdk';
import { CollisionWorld } from '@campus/shared';
import { createEndpoint, matchMaker } from '@colyseus/core';
import { createCampusServer } from '../../apps/server/src/server.js';
import { Game } from '../../apps/server/src/domain.js';
import { CampusRoom } from '../../apps/server/src/room.js';
import { Agent, IncomingMessage, request as httpRequest } from 'node:http';
import { TestClient, sleep, until } from '../helpers/client.js';

let host: Awaited<ReturnType<typeof createCampusServer>>;
afterEach(async () => { vi.restoreAllMocks(); await host?.close(); });
const body = { name: 'Admission', protocol: 1 };
const url = () => `http://127.0.0.1:${host.port}`;
const post = (method = 'create', options: unknown = body, headers: Record<string, string> = {}) =>
  fetch(`${url()}/matchmake/${method}/campus`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(options) });
function fromPeer(localAddress: string) {
  return new Promise<number>((resolve, reject) => {
    const req = httpRequest(`${url()}/matchmake/create/campus`, { localAddress, method: 'POST', headers: { 'content-type': 'application/json' } }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode!));
    });
    req.on('error', reject); req.end(JSON.stringify(body));
  });
}

it('all framework allocation routes share a peer bucket, ignore spoofed forwarded identities, and leave join/reconnect usable', async () => {
  host = await createCampusServer(0);
  const a = await TestClient.create(url());
  for (let i = 0; i < 5; i++) expect((await post(i % 2 ? 'joinOrCreate' : 'create')).status).toBe(200);
  for (const method of ['create', 'joinOrCreate']) {
    const response = await post(method, body, { origin: 'https://campus.example', 'x-forwarded-for': `192.0.2.${method.length}`, 'x-real-ip': '198.51.100.4', 'x-client-ip': '203.0.113.6', forwarded: 'for=203.0.113.7' });
    expect(response.status).toBe(429);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://campus.example');
    expect(response.headers.get('retry-after')).toBe('10');
    expect(await response.json()).toMatchObject({ code: 429 });
  }
  const b = await TestClient.join(url(), a.room.roomId);
  const token = b.room.reconnectionToken; b.room.connection.close(4010);
  await until(() => a.snapshot.players.some(p => p.id === b.room.sessionId && !p.connected));
  const restored = new TestClient(await new Client(url()).reconnect(token), new Client(url()));
  await until(() => !!restored.snapshot); expect(restored.room.sessionId).toBe(b.room.sessionId);
  await restored.room.leave(); await a.room.leave();
});

it('reserves capacity synchronously before expensive concurrent initialization and reclaims disposal', async () => {
  host = await createCampusServer(0, '127.0.0.1', { maxRooms: 2, createBurst: 100 });
  const original = CollisionWorld.create.bind(CollisionWorld);
  let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; });
  let initialized = 0;
  vi.spyOn(CollisionWorld, 'create').mockImplementation(async () => { initialized++; await barrier; return original(); });
  const requests = Array.from({ length: 8 }, (_, i) => post(i % 2 ? 'joinOrCreate' : 'create', { ...body, mode: 'solo' }));
  try {
    await until(() => initialized >= 2); await sleep(80); expect(initialized).toBe(2);
    const ready = await fetch(`${url()}/ready`); expect(await ready.json()).toMatchObject({ rooms: 2, capacity: 2 });
  } finally { release(); await Promise.allSettled(requests); }
  const responses = await Promise.all(requests);
  expect(responses.filter(r => r.status === 200)).toHaveLength(2);
  expect(responses.filter(r => r.status === 503)).toHaveLength(6);
  const reservation = await responses.find(r => r.status === 200)!.json();
  await matchMaker.getLocalRoomById(reservation.roomId)!.disconnect();
  expect((await post()).status).toBe(200);
});

it('readiness is empty/fresh healthy, with compatible liveness and no identities', async () => {
  host = await createCampusServer(0);
  let response = await fetch(`${url()}/ready`); expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ status: 'ready', rooms: 0, capacity: 32, simulation: { stale: 0, failed: 0 } });
  const a = await TestClient.create(url()); await sleep(80);
  response = await fetch(`${url()}/ready`); expect(response.status).toBe(200);
  const text = await response.text(); expect(text).not.toContain(a.room.roomId); expect(text).not.toContain('127.0.0.1');
  expect(JSON.parse(text)).toMatchObject({ status: 'ready', rooms: 1 });
  expect(await (await fetch(`${url()}/health`)).json()).toEqual({ ok: true, protocol: 1 });
  await a.room.leave();
});

it('malformed requests, aliases and framework paths cannot allocate around the bucket', async () => {
  host = await createCampusServer(0);
  const response = await fetch(`${url()}/matchmake/create/campus`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' });
  expect(response.status).toBe(400);
  for (let i = 0; i < 5; i++) expect((await post('create', { ...body, unexpected: true })).status).toBe(400);
  for (const path of ['/matchmake/create/campus', '/matchmake/joinOrCreate/campus?x=1', '/matchmake/create/campus/', '/matchmake/%63reate/campus', '//matchmake/create/campus', '/matchmake/create/campus/extra']) {
    const r = await fetch(`${url()}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect(r.status, path).not.toBe(200);
  }
  for (const method of ['join', 'joinById', 'reconnect', 'createRoom', 'handleCreateRoom']) {
    expect((await post(method)).status, method).not.toBe(200);
  }
  expect(await (await fetch(`${url()}/ready`)).json()).toMatchObject({ rooms: 0 });
  expect((await fetch(`${url()}/__healthcheck`)).status).toBe(200);
});

it('initialization failure releases capacity exactly once, later initialization and disposal work', async () => {
  host = await createCampusServer(0, '127.0.0.1', { maxRooms: 1 });
  vi.spyOn(CollisionWorld, 'create').mockRejectedValueOnce(new Error('injected init failure'));
  expect((await post()).status).not.toBe(200);
  expect(await (await fetch(`${url()}/ready`)).json()).toMatchObject({ rooms: 0, status: 'ready' });
  const a = await TestClient.create(url());
  expect((await post()).status).toBe(503);
  const room = matchMaker.getLocalRoomById(a.room.roomId)!;
  await a.room.leave(); await until(() => !matchMaker.getLocalRoomById(a.room.roomId));
  room.onDispose!();
  const b = await TestClient.create(url()); expect((await post()).status).toBe(503); await b.room.leave();
});

it('stale successful simulation returns 503 over HTTP, health remains live', async () => {
  host = await createCampusServer(0); const a = await TestClient.create(url()); await sleep(80);
  matchMaker.getLocalRoomById(a.room.roomId)!.setSimulationInterval();
  const now = performance.now(); vi.spyOn(performance, 'now').mockReturnValue(now + 2001);
  const response = await fetch(`${url()}/ready`); expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ status: 'degraded', simulation: { stale: 1 } });
  expect((await fetch(`${url()}/health`)).status).toBe(200);
  vi.restoreAllMocks(); await a.room.leave();
});

it('tick exception fails readiness, stops further ticks/actions, disposes without unhandled exceptions', async () => {
  host = await createCampusServer(0); const a = await TestClient.create(url());
  const room = matchMaker.getLocalRoomById(a.room.roomId)!;
  let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; });
  const disconnect = room.disconnect.bind(room);
  vi.spyOn(room, 'disconnect').mockImplementation(async code => { await barrier; return disconnect(code); });
  const failure = vi.spyOn(Game.prototype, 'tick').mockImplementation(() => { throw new Error('injected tick failure'); });
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await until(() => failure.mock.calls.length > 0);
    const response = await fetch(`${url()}/ready`); expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: 'degraded', simulation: { failed: 1 } });
    const tickCount = failure.mock.calls.length;
    const actions = vi.spyOn(Game.prototype, 'intent');
    a.room.send('intent', { type: 'ready', ready: true, roundId: 1, requestId: 'after-failure' });
    await sleep(100); expect(failure.mock.calls.length).toBe(tickCount); expect(actions).not.toHaveBeenCalled();
    expect((await fetch(`${url()}/health`)).status).toBe(200);
    expect(errors).toHaveBeenCalled();
  } finally { failure.mockRestore(); release(); }
  await until(() => !matchMaker.getLocalRoomById(a.room.roomId));
  expect(await (await fetch(`${url()}/ready`)).json()).toMatchObject({ rooms: 0, status: 'ready' });
});

it('drains readiness and rejects allocation before graceful disposal, including direct server shutdown', async () => {
  host = await createCampusServer(0); const a = await TestClient.create(url());
  const room = matchMaker.getLocalRoomById(a.room.roomId)!;
  let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; });
  const dispose = room.onDispose!.bind(room);
  vi.spyOn(room, 'onDispose').mockImplementation(async () => { await barrier; dispose(); });
  const closing = host.server.gracefullyShutdown(false);
  try {
    const response = await fetch(`${url()}/ready`); expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: 'draining' });
    expect((await post()).status).toBe(503); expect((await post('joinOrCreate')).status).toBe(503);
    expect((await fetch(`${url()}/health`)).status).toBe(200);
  } finally { release(); await closing; }
});

it('shutdown waits for in-flight initialization cleanup and never advertises its room', async () => {
  host = await createCampusServer(0);
  const original = CollisionWorld.create.bind(CollisionWorld);
  let entered = false, release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(CollisionWorld, 'create').mockImplementation(async () => { entered = true; await barrier; return original(); });
  const request = post(); await until(() => entered);
  let closed = false; const closing = host.close().then(() => { closed = true; });
  try {
    await sleep(80); expect(closed).toBe(false);
    const r = await fetch(`${url()}/ready`); expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ status: 'draining', rooms: 1 });
    expect((await post()).status).toBe(503);
  } finally { release(); }
  expect((await request).status).not.toBe(200); await closing;
});

it('real peer identities have separate budgets, bounded map saturation rejects rather than bypasses', async () => {
  host = await createCampusServer(0, '127.0.0.1', { maxIps: 2, createBurst: 1 });
  expect(await fromPeer('127.0.0.2')).toBe(200);
  expect(await fromPeer('127.0.0.2')).toBe(429);
  expect(await fromPeer('127.0.0.3')).toBe(200);
  expect(await fromPeer('127.0.0.4')).toBe(503);
  expect(await (await fetch(`${url()}/ready`)).json()).toMatchObject({ rooms: 2 });
});

it('internal/framework allocation without a transport identity fails closed before initialization', async () => {
  host = await createCampusServer(0);
  await expect(matchMaker.createRoom('campus', body)).rejects.toThrow(/thử lại/);
  await expect(matchMaker.handleCreateRoom('campus', body)).rejects.toThrow(/thử lại/);
  expect(await (await fetch(`${url()}/ready`)).json()).toMatchObject({ rooms: 0 });
});

it('an added framework allocation route cannot bypass transport-owned admission context', async () => {
  host = await createCampusServer(0);
  host.server.router.addEndpoint(createEndpoint('/unadmitted-create', { method: 'POST' }, async ctx => {
    try { return await matchMaker.createRoom('campus', body); }
    catch { throw ctx.error(503); }
  }));
  expect((await fetch(`${url()}/unadmitted-create`, { method: 'POST' })).status).toBe(503);
  expect(await (await fetch(`${url()}/ready`)).json()).toMatchObject({ rooms: 0 });
});

it('shutdown also waits between onCreate and framework registration, releasing once', async () => {
  host = await createCampusServer(0);
  const insert = matchMaker.driver.insert!.bind(matchMaker.driver);
  let entered = false, release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(matchMaker.driver, 'insert').mockImplementation(async room => { entered = true; await barrier; return insert(room); });
  const request = post(); await until(() => entered);
  let closed = false; const closing = host.close().then(() => { closed = true; });
  try { await sleep(80); expect(closed).toBe(false); }
  finally { release(); }
  await request; await closing;
});

it('throttle errors honor the same configured CORS policy as framework responses', async () => {
  host = await createCampusServer(0, '127.0.0.1', { createBurst: 1 });
  vi.spyOn(matchMaker.controller, 'getCorsHeaders').mockReturnValue({ 'Access-Control-Allow-Origin': 'https://allowed.example', Vary: 'Origin' });
  const first = await post('create', body, { origin: 'https://other.example' });
  const denied = await post('create', body, { origin: 'https://other.example' });
  expect(first.status).toBe(200); expect(denied.status).toBe(429);
  expect(denied.headers.get('access-control-allow-origin')).toBe(first.headers.get('access-control-allow-origin'));
  expect(denied.headers.get('vary')).toBe('Origin');
});

it('nested createRoom during initialization cannot reuse the admitted request', async () => {
  host = await createCampusServer(0);
  const original = CollisionWorld.create.bind(CollisionWorld);
  let nestedCode: number | undefined;
  vi.spyOn(CollisionWorld, 'create').mockImplementationOnce(async () => {
    try { await matchMaker.createRoom('campus', body); nestedCode = 200; }
    catch (error) { nestedCode = (error as { code: number }).code; }
    return original();
  });
  expect((await post()).status).toBe(200);
  expect(nestedCode).toBe(503);
  expect(await (await fetch(`${url()}/ready`)).json()).toMatchObject({ rooms: 1 });
});

it('simulation interval descendants cannot create another room after the response', async () => {
  host = await createCampusServer(0);
  const a = await TestClient.create(url());
  const tick = Game.prototype.tick; let attempted = false, code: number | undefined;
  vi.spyOn(Game.prototype, 'tick').mockImplementation(function (this: Game, elapsed) {
    tick.call(this, elapsed);
    if (!attempted) { attempted = true; void matchMaker.createRoom('campus', body).then(() => { code = 200; }, error => { code = error.code; }); }
  });
  await until(() => code !== undefined); expect(code).toBe(503);
  expect(await (await fetch(`${url()}/ready`)).json()).toMatchObject({ rooms: 1 });
  await a.room.leave();
});

it('failed post-onCreate record cleans reservation and collision before dispatch returns', async () => {
  host = await createCampusServer(0, '127.0.0.1', { maxRooms: 1 });
  const dispose = vi.spyOn(CollisionWorld.prototype, 'dispose');
  const create = CampusRoom.prototype.onCreate; let failedRoom: CampusRoom | undefined;
  vi.spyOn(CampusRoom.prototype, 'onCreate').mockImplementationOnce(async function (this: CampusRoom, options) {
    failedRoom = this; await create.call(this, options);
  });
  vi.spyOn(matchMaker.driver, 'insert').mockRejectedValueOnce(new Error('record failure after onCreate'));
  expect((await post()).status).not.toBe(200);
  expect(await (await fetch(`${url()}/ready`)).json()).toMatchObject({ rooms: 0, status: 'ready' });
  expect(dispose).toHaveBeenCalledTimes(1);
  failedRoom!.onDispose(); expect(dispose).toHaveBeenCalledTimes(1);
  expect((await post()).status).toBe(200);
});

it('failing configured CORS hook cannot cause an unhandled error or permissive fallback', async () => {
  host = await createCampusServer(0, '127.0.0.1', { createBurst: 1 });
  expect((await post()).status).toBe(200);
  vi.spyOn(matchMaker.controller, 'getCorsHeaders').mockImplementation(() => { throw new Error('CORS policy failed'); });
  const response = await post('create', body, { origin: 'https://other.example' });
  expect(response.status).toBe(429); expect(response.headers.get('access-control-allow-origin')).toBeNull();
  expect(await response.json()).toMatchObject({ code: 429 });
});

it('unused grant expires after invalid creation dispatch; its delayed descendant cannot reserve even once', async () => {
  host = await createCampusServer(0);
  let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; });
  let late!: Promise<number>;
  const create = CampusRoom.prototype.onCreate;
  vi.spyOn(CampusRoom.prototype, 'onCreate').mockImplementationOnce(async function (this: CampusRoom, options) {
    late = (async () => { await barrier; try { await matchMaker.createRoom('campus', body); return 200; } catch (error) { return (error as { code: number }).code; } })();
    await create.call(this, options);
  });
  expect((await post('create', { ...body, unexpected: true })).status).toBe(400);
  release(); expect(await late).toBe(503);
  expect(await (await fetch(`${url()}/ready`)).json()).toMatchObject({ rooms: 0 });
});

it('post-onCreate IPC registration failure cleans the registered reference and reservation', async () => {
  host = await createCampusServer(0, '127.0.0.1', { maxRooms: 1 });
  const subscribe = matchMaker.presence.subscribe.bind(matchMaker.presence);
  let rejected = false;
  vi.spyOn(matchMaker.presence, 'subscribe').mockImplementation(async (channel, callback) => {
    if (!rejected && channel.startsWith('$')) { rejected = true; throw new Error('IPC registration failure'); }
    return subscribe(channel, callback);
  });
  const response = await post(); expect(rejected).toBe(true); expect(response.status).not.toBe(200);
  expect(await (await fetch(`${url()}/ready`)).json()).toMatchObject({ status: 'ready', rooms: 0 });
  expect(await matchMaker.query({ name: 'campus' })).toHaveLength(0);
  expect((await post()).status).toBe(200);
});

it('refused allocation drains its body and keeps the HTTP connection usable', async () => {
  host = await createCampusServer(0, '127.0.0.1', { createBurst: 1 });
  expect((await post()).status).toBe(200);
  const agent = new Agent({ keepAlive: true, maxSockets: 1 });
  const resume = vi.spyOn(IncomingMessage.prototype, 'resume');
  const send = (path: string, payload?: string) => new Promise<{ status: number; reused: boolean }>((resolve, reject) => {
    const req = httpRequest(`${url()}${path}`, { agent, method: payload ? 'POST' : 'GET', headers: { 'content-type': 'application/json' } }, res => {
      res.resume(); res.on('end', () => resolve({ status: res.statusCode!, reused: req.reusedSocket }));
    });
    req.on('error', reject); req.end(payload);
  });
  try {
    expect((await send('/matchmake/create/campus', JSON.stringify({ ...body, padding: 'x'.repeat(100000) }))).status).toBe(429);
    expect(resume.mock.contexts.some(req => req instanceof IncomingMessage && req.url === '/matchmake/create/campus' && req.method === 'POST')).toBe(true);
    expect(await send('/health')).toEqual({ status: 200, reused: true });
  } finally { agent.destroy(); }
});
