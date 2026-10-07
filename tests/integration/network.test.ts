import { afterEach, beforeEach, expect, it } from 'vitest';
import { Client } from '@colyseus/sdk';
import { createCampusServer } from '../../apps/server/src/server.js';
import { TestClient, until, sleep } from '../helpers/client.js';
import { CollisionWorld, distance } from '../../packages/shared/src/movement.js';

let host: Awaited<ReturnType<typeof createCampusServer>>;
let endpoint: string;
const peers: TestClient[] = [];
// Each independent scenario owns its server and default admission budget.
beforeEach(async () => { host = await createCampusServer(0); endpoint = `ws://127.0.0.1:${host.port}`; });
afterEach(async () => { for (const p of peers.splice(0)) if (p.room.connection.isOpen) await p.room.leave().catch(() => {}); await host?.close(); });

it('uses private room code, two ready guests and authoritative snapshots across actual WebSockets', async () => {
  const a = await TestClient.create(endpoint); peers.push(a);
  const b = await TestClient.join(endpoint, a.room.roomId); peers.push(b);
  a.room.send('sync', { protocol: 1 }); await sleep(100);
  expect(a.snapshot.players).toHaveLength(2);
  expect(a.snapshot.roomCode).toMatch(/^[A-Z2-9]{8}$/);
  expect((await a.act({ type: 'start' })).code).toBe('NOT_READY');
  await a.act({ type: 'ready', ready: true }); await b.act({ type: 'ready', ready: true });
  expect((await a.act({ type: 'start' })).ok).toBe(true);
  await until(() => b.snapshot.phase === 'supply');
  expect(b.snapshot.items).toHaveLength(9);
  await expect(new Client(endpoint).joinById(a.room.roomId, { name: 'Late', protocol: 1 })).rejects.toThrow();
  const before = { ...a.player.position };
  for (let i = 0; i < 10; i++) { a.input(0, 1); await sleep(34); }
  await until(() => a.player.position.z > before.z + 1);
  expect(a.player.position.z - before.z).toBeLessThan(3);
  await sleep(450); const stopped = a.player.position.z; await sleep(300);
  expect(a.player.position.z).toBeCloseTo(stopped, 4);
});

it('isolates two rooms, allows four guests, rejects fifth, transfers leader on voluntary leave', async () => {
  const a = await TestClient.create(endpoint); peers.push(a);
  const others = await Promise.all(['B', 'C', 'D'].map(name => TestClient.join(endpoint, a.room.roomId, name))); peers.push(...others);
  await until(() => a.snapshot.players.length === 4);
  expect(new Set(a.snapshot.players.map(p => p.variant)).size).toBe(4);
  await expect(TestClient.join(endpoint, a.room.roomId, 'E')).rejects.toThrow();
  const isolated = await TestClient.create(endpoint); peers.push(isolated);
  expect(isolated.snapshot.players).toHaveLength(1);
  expect(isolated.snapshot.players.some(p => p.id === a.room.sessionId)).toBe(false);
  await a.room.leave();
  await until(() => others[0]!.snapshot.players.length === 3);
  expect(others[0]!.snapshot.leaderId).not.toBe(a.room.sessionId);
  expect(isolated.snapshot.phase).toBe('lobby');
});

it('reserves dropped connection and reconnects same identity with current state', async () => {
  const a = await TestClient.create(endpoint); peers.push(a);
  const b = await TestClient.join(endpoint, a.room.roomId); peers.push(b);
  const token = a.room.reconnectionToken;
  a.room.connection.close(4010);
  await until(() => b.snapshot.players.some(p => p.id === a.room.sessionId && !p.connected));
  expect(b.snapshot.leaderId).toBe(b.room.sessionId);
  const recovered = new TestClient(await new Client(endpoint).reconnect(token), new Client(endpoint)); peers.push(recovered);
  await until(() => !!recovered.snapshot);
  expect(recovered.room.sessionId).toBe(a.room.sessionId);
  expect(recovered.player.connected).toBe(true);
  expect(recovered.snapshot.leaderId).toBe(b.room.sessionId);
});

it('counts a disconnected reserved seat against lobby capacity, then admits a replacement after voluntary removal', async () => {
  const a = await TestClient.create(endpoint); peers.push(a);
  const team = await Promise.all(['B', 'C', 'D'].map(name => TestClient.join(endpoint, a.room.roomId, name))); peers.push(...team);
  const old = team[0]!; const token = old.room.reconnectionToken; old.room.connection.close(4010);
  await until(() => a.snapshot.players.some(p => p.id === old.room.sessionId && !p.connected));
  await expect(TestClient.join(endpoint, a.room.roomId, 'Replacement')).rejects.toThrow();
  const restored = new TestClient(await new Client(endpoint).reconnect(token), new Client(endpoint)); peers.push(restored);
  await until(() => !!restored.snapshot);
  expect(restored.room.sessionId).toBe(old.room.sessionId);
  await restored.room.leave(); await until(() => a.snapshot.players.length === 3);
  const replacement = await TestClient.join(endpoint, a.room.roomId, 'Replacement'); peers.push(replacement);
  expect(replacement.snapshot.players).toHaveLength(4);
});

it('retains request dedup across reconnect after ownership has already changed again', async () => {
  const a = await TestClient.create(endpoint); peers.push(a);
  const b = await TestClient.join(endpoint, a.room.roomId); peers.push(b);
  await a.act({ type: 'ready', ready: true }); await b.act({ type: 'ready', ready: true }); await a.act({ type: 'start' });
  await until(() => a.snapshot.phase === 'supply');
  const world = await CollisionWorld.create();
  try {
    await a.walk(world, a.snapshot.items.find(i => i.id === 'crate-a')!.position);
    const intent = { type: 'pickup', requestId: 'across-reconnect', roundId: 1, itemId: 'crate-a', expectedRevision: 0 };
    a.room.send('intent', intent); await until(() => a.results.some(r => r.requestId === intent.requestId));
    const original = a.results.find(r => r.requestId === intent.requestId)!; expect(original.ok).toBe(true);
    const token = a.room.reconnectionToken; a.room.connection.close(4010);
    await until(() => b.snapshot.items.find(i => i.id === 'crate-a')!.revision === 2, 6000);
    const restored = new TestClient(await new Client(endpoint).reconnect(token), new Client(endpoint)); peers.push(restored);
    await until(() => !!restored.snapshot);
    restored.room.send('intent', intent);
    await until(() => restored.results.length > 0);
    expect(restored.results[0]).toEqual(original);
    expect(restored.player.heldItemId).toBeNull();
    expect(restored.snapshot.items.find(i => i.id === 'crate-a')).toMatchObject({ revision: 2, state: 'WORLD', holderId: null });
    restored.room.send('intent', { ...intent, itemId: 'crate-b' });
    await until(() => restored.results.length === 2); expect(restored.results[1]!.code).toBe('REQUEST_CONFLICT');
  } finally { world.dispose(); }
});

it('four active clients stay isolated from a second room under actual delayed WebSocket traffic; duplicate pickup remains once-only', async () => {
  const a = await TestClient.create(endpoint); peers.push(a);
  const team = await Promise.all(['B', 'C', 'D'].map(name => TestClient.join(endpoint, a.room.roomId, name))); peers.push(...team);
  const other = await TestClient.create(endpoint); peers.push(other);
  for (const p of [a, ...team]) await p.act({ type: 'ready', ready: true });
  await a.act({ type: 'start' }); await until(() => a.snapshot.phase === 'supply');
  const world = await CollisionWorld.create();
  try {
    const item = a.snapshot.items.find(i => i.id === 'crate-a')!;
    await a.walk(world, item.position);
    // Colyseus delays inbound/outbound on the real transport, not a fake SDK.
    host.server.simulateLatency(100);
    const payload = { type: 'pickup', requestId: 'delayed-pickup', roundId: 1, itemId: 'crate-a', expectedRevision: 0 };
    a.room.send('intent', payload); a.room.send('intent', payload);
    await until(() => a.results.filter(r => r.requestId === 'delayed-pickup').length === 2);
    expect(a.results.filter(r => r.requestId === 'delayed-pickup').every(r => r.ok)).toBe(true);
    await until(() => [a, ...team].every(p => p.snapshot.items.find(i => i.id === 'crate-a')!.holderId === a.room.sessionId));
    expect(a.snapshot.items.find(i => i.id === 'crate-a')!.revision).toBe(1);
    const mover = team[0]!; const start = { ...mover.player.position };
    for (const gap of [20, 60, 30, 80, 25, 50, 90, 20]) { mover.input(0, 1); await sleep(gap); }
    mover.input(0, 0); await sleep(600);
    expect(distance(start, mover.player.position)).toBeGreaterThan(.5);
    expect(distance(start, mover.player.position)).toBeLessThan(4);
    const final = { ...mover.player.position }; await sleep(400);
    expect(distance(final, mover.player.position)).toBeLessThan(.001);
    expect(other.snapshot).toMatchObject({ phase: 'lobby', score: 0 });
    expect(other.snapshot.items.find(i => i.id === 'crate-a')).toMatchObject({ state: 'WORLD', revision: 0 });
    expect(other.snapshot.players).toHaveLength(1);
  } finally { host.server.simulateLatency(0); world.dispose(); }
});

it('health is reachable on the default loopback listener, invalid join fields are refused', async () => {
  expect(host.http.address()).toMatchObject({ address: '127.0.0.1' });
  const response = await fetch(`http://127.0.0.1:${host.port}/health`);
  expect(await response.json()).toEqual({ ok: true, protocol: 1 });
  const a = await TestClient.create(endpoint); peers.push(a);
  await expect(new Client(endpoint).joinById(a.room.roomId, { name: '<script>', protocol: 1 })).rejects.toThrow();
  await expect(new Client(endpoint).joinById(a.room.roomId, { name: 'Khách', protocol: 9 })).rejects.toThrow();
  await sleep(100); expect(a.snapshot.players).toHaveLength(1);
});
