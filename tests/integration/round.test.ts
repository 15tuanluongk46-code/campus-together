import { afterAll, beforeAll, expect, it } from 'vitest';
import { Client } from '@colyseus/sdk';
import { createCampusServer } from '../../apps/server/src/server.js';
import { CollisionWorld } from '../../packages/shared/src/movement.js';
import { TARGETS } from '../../packages/shared/src/world.js';
import { TestClient, until, sleep } from '../helpers/client.js';

let host: Awaited<ReturnType<typeof createCampusServer>>;
let endpoint: string;
let world: CollisionWorld;
const peers: TestClient[] = [];
beforeAll(async () => {
  host = await createCampusServer(0); endpoint = `ws://127.0.0.1:${host.port}`;
  world = await CollisionWorld.create();
});
afterAll(async () => {
  for (const p of peers) if (p.room.connection.isOpen) await p.room.leave().catch(() => {});
  world?.dispose(); await host?.close();
});
const target = (id: string) => TARGETS.find(t => t.id === id)!.position;
async function deliver(peer: TestClient, itemId: string, targetId: string) {
  let item = peer.snapshot.items.find(i => i.id === itemId)!;
  await peer.walk(world, item.position);
  expect((await peer.act({ type: 'pickup', itemId, expectedRevision: item.revision })).code).toBe('OK');
  await until(() => peer.player.heldItemId === itemId);
  await peer.walk(world, target(targetId));
  item = peer.snapshot.items.find(i => i.id === itemId)!;
  expect((await peer.act({ type: 'place', itemId, expectedRevision: item.revision, targetId })).code).toBe('OK');
  await until(() => peer.player.heldItemId === null);
}

it.each([2, 3, 4])('finishes the entire round with %i actual socket clients using only legitimate movement, items and hold heartbeats; then replays', async count => {
  let a = await TestClient.create(endpoint); peers.push(a);
  const b = await TestClient.join(endpoint, a.room.roomId); peers.push(b);
  const extras = await Promise.all(['Chi', 'Dũng'].slice(0, count - 2).map(name => TestClient.join(endpoint, a.room.roomId, name))); peers.push(...extras);
  for (const p of [a, b, ...extras]) await p.act({ type: 'ready', ready: true });
  await a.act({ type: 'start' }); await until(() => b.snapshot.phase === 'supply');

  // Real contested pickup, then disconnect while carrying and observe the 3-second safe drop.
  const crate = a.snapshot.items.find(i => i.id === 'crate-a')!;
  await Promise.all([a.walk(world, crate.position), b.walk(world, crate.position)]);
  const race = await Promise.all([
    a.act({ type: 'pickup', itemId: 'crate-a', expectedRevision: 0 }),
    b.act({ type: 'pickup', itemId: 'crate-a', expectedRevision: 0 }),
  ]);
  expect(race.filter(r => r.ok)).toHaveLength(1);
  expect(race.filter(r => r.code === 'STALE_REVISION')).toHaveLength(1);
  const winner = race[0]!.ok ? a : b;
  const observer = winner === a ? b : a;
  await until(() => winner.player.heldItemId === 'crate-a');
  const token = winner.room.reconnectionToken;
  winner.room.connection.close(4010);
  await until(() => observer.snapshot.players.some(p => p.id === winner.room.sessionId && !p.connected));
  await until(() => observer.snapshot.items.find(i => i.id === 'crate-a')!.state === 'WORLD', 5000);
  const restored = new TestClient(await new Client(endpoint).reconnect(token), new Client(endpoint)); peers.push(restored);
  await until(() => !!restored.snapshot);
  expect(restored.player.heldItemId).toBeNull();
  // Keep b constant for readability, select the two current live actors instead.
  const actors = [observer, restored] as const;
  a = actors[0]; const partner = actors[1];
  await Promise.all([
    (async () => { await deliver(a, 'crate-a', 'decor-a'); await deliver(a, 'cable', 'cable-socket'); })(),
    (async () => { await deliver(partner, 'crate-b', 'decor-b'); await deliver(partner, 'fuse', 'fuse-socket'); })(),
  ]);
  await until(() => a.snapshot.phase === 'power');
  expect(a.snapshot.score).toBe(400);
  expect((await a.act({ type: 'read-clue' })).code).toBe('OUT_OF_REACH');
  await partner.walk(world, target('clue-board'));
  const clue = (await partner.act({ type: 'read-clue' })).clue!;
  expect(clue).toHaveLength(3);
  for (let slot = 0; slot < 3; slot++) await deliver(a, `module-${clue[slot]}`, `power-${slot}`);
  await until(() => partner.snapshot.phase === 'launch');
  if (extras.length) await Promise.all([deliver(extras[0]!, 'banner', 'banner-socket'), deliver(extras[1] ?? partner, 'lantern', 'lantern-socket')]);
  await Promise.all([a.walk(world, target('station-a')), partner.walk(world, target('station-b'))]);

  // One player cannot operate two stations; interrupted hold resets progress.
  expect((await a.act({ type: 'hold', targetId: 'station-b', active: true })).ok).toBe(false);
  for (let i = 0; i < 5; i++) {
    await Promise.all([a.act({ type: 'hold', targetId: 'station-a', active: true }), partner.act({ type: 'hold', targetId: 'station-b', active: true })]);
    await sleep(120);
  }
  expect(a.snapshot.launchProgressMs).toBeGreaterThan(100);
  await partner.act({ type: 'hold', targetId: 'station-b', active: false });
  await until(() => a.snapshot.launchProgressMs === 0);
  const end = Date.now() + 5000;
  while (a.snapshot.phase !== 'results') {
    if (Date.now() > end) throw new Error('Festival hold did not complete');
    await Promise.all([a.act({ type: 'hold', targetId: 'station-a', active: true }), partner.act({ type: 'hold', targetId: 'station-b', active: true })]);
    await sleep(120);
  }
  expect(a.snapshot).toMatchObject({ result: 'success', score: count >= 3 ? 1300 : 1200, gateOpen: false, gateChargeMs: 0, gateRemainingMs: 0 });
  const leader = a.snapshot.leaderId === a.room.sessionId ? a : partner;
  expect((await leader.act({ type: 'replay' })).ok).toBe(true);
  await until(() => a.snapshot.roundId === 2 && partner.snapshot.roundId === 2);
  expect(a.snapshot).toMatchObject({ phase: 'lobby', score: 0, powerStep: 0 });
  expect(a.snapshot.items.every(i => i.state === 'WORLD' && i.revision === 0)).toBe(true);
  if (count === 2) {
    const newcomer = await TestClient.join(endpoint, a.room.roomId, 'Chi'); peers.push(newcomer);
    expect(newcomer.snapshot.players).toHaveLength(3);
  }
}, 480_000);
