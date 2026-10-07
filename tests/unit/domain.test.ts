import { afterEach, expect, it } from 'vitest';
import { Game } from '../../apps/server/src/domain.js';
import { CollisionWorld, distance } from '../../packages/shared/src/movement.js';
import { TARGETS } from '../../packages/shared/src/world.js';
import type { Intent, Vec3 } from '../../packages/shared/src/protocol.js';
import { route } from '../helpers/navigation.js';

const worlds: CollisionWorld[] = [];
afterEach(() => worlds.splice(0).forEach(w => w.dispose()));
let request = 0;
type Action = Intent extends infer T ? T extends Intent ? Omit<T, 'requestId' | 'roundId'> : never : never;
function act(g: Game, id: string, body: Action) { return g.intent(id, { ...body, requestId: `r${++request}`, roundId: g.snapshot().roundId }); }
async function setup(players = 2, layout = 0, clue = 0) {
  const w = await CollisionWorld.create(); worlds.push(w);
  const g = new Game(w, { layout, clue });
  for (const id of ['a', 'b', 'c', 'd'].slice(0, players)) { g.join(id, id); act(g, id, { type: 'ready', ready: true }); }
  expect(act(g, 'a', { type: 'start' }).ok).toBe(true);
  return { g, w };
}
function walk(g: Game, w: CollisionWorld, id: string, to: Vec3) {
  const player = () => g.snapshot().players.find(p => p.id === id)!;
  for (const waypoint of route(w, player().position, to)) {
    let n = 0;
    while (distance(player().position, waypoint) > .12) {
      if (++n > 600) throw new Error(`Stuck ${id} at ${JSON.stringify(player().position)} heading ${JSON.stringify(waypoint)}`);
      const p = player(); const d = distance(p.position, waypoint);
      g.input(id, { seq: p.ackSeq + 1, roundId: g.snapshot().roundId, x: (waypoint.x - p.position.x) / Math.max(d, .2), z: (waypoint.z - p.position.z) / Math.max(d, .2), sprint: true });
      g.tick();
    }
  }
  g.input(id, { seq: player().ackSeq + 1, roundId: g.snapshot().roundId, x: 0, z: 0, sprint: false }); g.tick();
}
function deliver(g: Game, w: CollisionWorld, itemId: string, targetId: string, id = 'a') {
  let item = g.snapshot().items.find(i => i.id === itemId)!;
  walk(g, w, id, item.position);
  expect(act(g, id, { type: 'pickup', itemId, expectedRevision: item.revision }).code).toBe('OK');
  walk(g, w, id, TARGETS.find(t => t.id === targetId)!.position);
  item = g.snapshot().items.find(i => i.id === itemId)!;
  expect(act(g, id, { type: 'place', itemId, expectedRevision: item.revision, targetId }).code).toBe('OK');
}
function supply(g: Game, w: CollisionWorld) {
  for (const [item, target] of [['crate-a', 'decor-a'], ['crate-b', 'decor-b'], ['cable', 'cable-socket'], ['fuse', 'fuse-socket']] as const) deliver(g, w, item, target);
}

it('serializes a contested pickup, deduplicates request IDs and guards stale revision/full hands', async () => {
  const { g, w } = await setup();
  const position = g.snapshot().items.find(i => i.id === 'crate-a')!.position;
  walk(g, w, 'a', position); walk(g, w, 'b', position);
  const intent = { type: 'pickup', requestId: 'race', roundId: 1, itemId: 'crate-a', expectedRevision: 0 };
  expect(g.intent('a', intent).code).toBe('OK');
  expect(g.intent('b', intent).code).toBe('STALE_REVISION');
  expect(g.intent('a', intent).code).toBe('OK');
  expect(g.intent('a', { ...intent, itemId: 'crate-b' }).code).toBe('REQUEST_CONFLICT');
  expect(act(g, 'a', { type: 'pickup', itemId: 'crate-b', expectedRevision: 0 }).code).toBe('HANDS_FULL');
  expect(g.snapshot().items.find(i => i.id === 'crate-a')).toMatchObject({ revision: 1, holderId: 'a' });
});

it('rejects through-wall pickup within reach and rejects unknown/forged data', async () => {
  const { g, w } = await setup();
  // Drop cable just inside east storage wall; b is within 1.6 m but outside the wall.
  walk(g, w, 'a', { x: -14, y: 0, z: 3 });
  expect(act(g, 'a', { type: 'pickup', itemId: 'cable', expectedRevision: 0 }).ok).toBe(true);
  walk(g, w, 'a', { x: -13, y: 0, z: 3 });
  expect(act(g, 'a', { type: 'drop', itemId: 'cable', expectedRevision: 1 }).code).toBe('UNSAFE_DROP');
  expect(g.snapshot().items.find(i => i.id === 'cable')).toMatchObject({ state: 'CARRIED', revision: 1 });
  walk(g, w, 'a', { x: -14, y: 0, z: 3 });
  walk(g, w, 'a', { x: -13.65, y: 0, z: 3 });
  expect(act(g, 'a', { type: 'drop', itemId: 'cable', expectedRevision: 1 }).code).toBe('OK');
  const dropped = g.snapshot().items.find(i => i.id === 'cable')!;
  walk(g, w, 'b', { x: -11.4, y: 0, z: dropped.position.z });
  const r = act(g, 'b', { type: 'pickup', itemId: 'cable', expectedRevision: 2 });
  expect(r.code).toBe('BLOCKED');
  expect(w.hasLineOfSight({ x: -12.6, y: 0, z: 3 }, { x: -11.4, y: 0, z: 3 })).toBe(false);
  expect(g.intent('a', { type: 'pickup', requestId: 'bad', roundId: 1, itemId: 'fuse', expectedRevision: 0, position: { x: 99 }, playerId: 'b' }).code).toBe('INVALID');
  expect(g.input('a', { seq: 999, roundId: 1, x: NaN, z: 0, sprint: true })).toBe(false);
});

it('expires movement, rejects replayed sequences, and bounds diagonal and crate speed', async () => {
  const { g, w } = await setup();
  g.input('a', { seq: 1, roundId: 1, x: 1, z: 1, sprint: true });
  for (let i = 0; i < 30; i++) g.tick();
  const p = g.snapshot().players[0]!;
  expect(distance(p.position, { x: -8, y: 0, z: 0 })).toBeLessThan(1.5);
  expect(p.ackSeq).toBe(1);
  expect(g.input('a', { seq: 1, roundId: 1, x: -1, z: 0, sprint: true })).toBe(false);
  let a = { x: 4, y: 0, z: 12 };
  for (let i = 0; i < 30; i++) a = w.move(a, { x: 1, z: 1, sprint: true }, true);
  expect(distance(a, { x: 4, y: 0, z: 12 })).toBeCloseTo(3, 2);
});

it.each([0, 1, 2])('completes all three phases in layout %i with exactly-once score and replay', async layout => {
  const { g, w } = await setup(2, layout, layout);
  supply(g, w); expect(g.snapshot().phase).toBe('power'); expect(g.snapshot().score).toBe(400);
  walk(g, w, 'b', TARGETS.find(t => t.id === 'clue-board')!.position);
  const clue = act(g, 'b', { type: 'read-clue' }).clue!;
  expect(clue).toHaveLength(3);
  for (let slot = 0; slot < 3; slot++) deliver(g, w, `module-${clue[slot]}`, `power-${slot}`);
  expect(g.snapshot().phase).toBe('launch');
  deliver(g, w, 'banner', 'banner-socket', 'b');
  expect(g.snapshot().score).toBe(750);
  walk(g, w, 'a', TARGETS.find(t => t.id === 'station-a')!.position);
  walk(g, w, 'b', TARGETS.find(t => t.id === 'station-b')!.position);
  for (let i = 0; i < 91; i++) {
    if (i % 4 === 0) { act(g, 'a', { type: 'hold', targetId: 'station-a', active: true }); act(g, 'b', { type: 'hold', targetId: 'station-b', active: true }); }
    g.tick();
  }
  expect(g.snapshot()).toMatchObject({ phase: 'results', result: 'success', score: 1250 });
  expect(act(g, 'b', { type: 'replay' }).code).toBe('NOT_LEADER');
  expect(act(g, 'a', { type: 'replay' }).ok).toBe(true);
  expect(g.snapshot()).toMatchObject({ phase: 'lobby', roundId: 2, score: 0, launchProgressMs: 0 });
  expect(g.snapshot().players.every(p => !p.ready && !p.heldItemId)).toBe(true);
  expect(g.intent('a', { type: 'ready', requestId: 'old', roundId: 1, ready: true }).code).toBe('OLD_ROUND');
});

it('wrong target/order preserves item and progress, valid delivery cannot be farmed', async () => {
  const { g, w } = await setup(); supply(g, w);
  walk(g, w, 'a', g.snapshot().items.find(i => i.id === 'module-leaf')!.position);
  act(g, 'a', { type: 'pickup', itemId: 'module-leaf', expectedRevision: 0 });
  walk(g, w, 'a', TARGETS.find(t => t.id === 'power-0')!.position);
  expect(act(g, 'a', { type: 'place', itemId: 'module-leaf', expectedRevision: 1, targetId: 'power-0' }).code).toBe('WRONG_ORDER');
  expect(g.snapshot().items.find(i => i.id === 'module-leaf')).toMatchObject({ state: 'CARRIED', revision: 1 });
  expect(g.snapshot().score).toBe(400);
  expect(act(g, 'a', { type: 'pickup', itemId: 'crate-a', expectedRevision: 2 }).ok).toBe(false);
});

it('drops at 3 seconds after disconnection, reserves seat, transfers leader and never resurrects ownership', async () => {
  const { g, w } = await setup();
  walk(g, w, 'a', g.snapshot().items[0]!.position);
  act(g, 'a', { type: 'pickup', itemId: 'crate-a', expectedRevision: 0 });
  g.disconnect('a');
  expect(g.snapshot().leaderId).toBe('b');
  for (let i = 0; i < 89; i++) g.tick();
  expect(g.snapshot().items[0]!.state).toBe('CARRIED');
  for (let i = 0; i < 2; i++) g.tick();
  expect(g.snapshot().items[0]).toMatchObject({ state: 'WORLD', revision: 2, holderId: null });
  expect(g.reconnect('a')).toBe(true);
  expect(g.snapshot().players.find(p => p.id === 'a')!.heldItemId).toBeNull();
  g.disconnect('a'); for (let i = 0; i < 901; i++) g.tick();
  expect(g.reconnect('a')).toBe(false);
  expect(g.snapshot().players).toHaveLength(1);
  for (let i = 0; i < 901; i++) g.tick();
  expect(g.snapshot().result).toBe('alone');
});

it('ends on timeout and requires two ready players, leader start, no active-round joins', async () => {
  const w = await CollisionWorld.create(); worlds.push(w);
  const g = new Game(w, { layout: 0, clue: 0 }); g.join('a', 'A');
  expect(act(g, 'a', { type: 'start' }).code).toBe('NOT_READY');
  g.join('b', 'B'); act(g, 'a', { type: 'ready', ready: true });
  expect(act(g, 'b', { type: 'start' }).code).toBe('NOT_LEADER');
  act(g, 'b', { type: 'ready', ready: true }); act(g, 'a', { type: 'start' });
  expect(g.join('c', 'C')).toBe(false);
  g.tick(720001);
  expect(g.snapshot()).toMatchObject({ phase: 'results', result: 'timeout' });
});

it('rate limits intent floods and stale holds close the gate', async () => {
  const { g, w } = await setup();
  walk(g, w, 'a', TARGETS.find(t => t.id === 'gate-switch')!.position);
  expect(act(g, 'a', { type: 'hold', targetId: 'gate-switch', active: true }).ok).toBe(true);
  g.tick(); expect(g.snapshot().gateOpen).toBe(true);
  for (let i = 0; i < 20; i++) g.tick();
  expect(g.snapshot().gateOpen).toBe(false);
  const results = Array.from({ length: 50 }, () => act(g, 'a', { type: 'ping', targetId: 'gate-switch', preset: 'help' }));
  expect(results.some(r => r.code === 'RATE_LIMIT')).toBe(true);
  expect(g.snapshot().pings.length).toBeLessThanOrEqual(8);
});

it('allows the advertised Q location ping on a current player but refuses unknown identities', async () => {
  const { g } = await setup();
  expect(act(g, 'a', { type: 'ping', targetId: 'a', preset: 'here' }).code).toBe('OK');
  expect(g.snapshot().pings[0]).toMatchObject({ targetId: 'a', playerId: 'a', preset: 'here' });
  expect(act(g, 'a', { type: 'ping', targetId: 'missing-player', preset: 'here' }).code).toBe('WRONG_TARGET');
});

it('completed deliveries survive voluntary departure, reconnect before 3 seconds retains ownership', async () => {
  const { g, w } = await setup(3);
  deliver(g, w, 'crate-a', 'decor-a');
  walk(g, w, 'a', g.snapshot().items.find(i => i.id === 'crate-b')!.position);
  act(g, 'a', { type: 'pickup', itemId: 'crate-b', expectedRevision: 0 });
  g.disconnect('a'); for (let i = 0; i < 30; i++) g.tick();
  expect(g.reconnect('a')).toBe(true);
  expect(g.snapshot().players.find(p => p.id === 'a')!.heldItemId).toBe('crate-b');
  g.disconnect('a', true);
  expect(g.snapshot().items.find(i => i.id === 'crate-b')).toMatchObject({ state: 'WORLD', revision: 2 });
  expect(g.snapshot().items.find(i => i.id === 'crate-a')).toMatchObject({ state: 'DELIVERED', revision: 2 });
  expect(g.snapshot().targets.find(t => t.id === 'decor-a')!.itemId).toBe('crate-a');
  expect(g.snapshot().score).toBe(100);
  expect(g.snapshot().soloRemainingMs).toBeNull();
});

it('gate interlock prevents closing onto a traversing player and closes once clear', async () => {
  const { g, w } = await setup();
  walk(g, w, 'a', TARGETS.find(t => t.id === 'gate-switch')!.position);
  walk(g, w, 'b', { x: -1, y: 0, z: 0 });
  act(g, 'a', { type: 'hold', targetId: 'gate-switch', active: true }); g.tick();
  for (let i = 0; i < 8; i++) {
    const p = g.snapshot().players.find(p => p.id === 'b')!;
    g.input('b', { seq: p.ackSeq + 1, roundId: 1, x: 1, z: 0, sprint: false }); g.tick();
  }
  const p = g.snapshot().players.find(p => p.id === 'b')!;
  g.input('b', { seq: p.ackSeq + 1, roundId: 1, x: 0, z: 0, sprint: false });
  act(g, 'a', { type: 'hold', targetId: 'gate-switch', active: false }); g.tick();
  expect(Math.abs(g.snapshot().players.find(p => p.id === 'b')!.position.x)).toBeLessThan(.55);
  expect(g.snapshot().gateOpen).toBe(true);
  g.disconnect('b'); g.tick(1000);
  expect(g.snapshot().gateOpen).toBe(true); // reserved avatar still occupies the doorway
  expect(g.reconnect('b')).toBe(true);
  walk(g, w, 'b', { x: 2, y: 0, z: 0 });
  expect(g.snapshot().gateOpen).toBe(false);
});

it('wrong socket and repeated place requests never lose the held item or double score', async () => {
  const { g, w } = await setup();
  walk(g, w, 'a', g.snapshot().items[0]!.position);
  act(g, 'a', { type: 'pickup', itemId: 'crate-a', expectedRevision: 0 });
  expect(act(g, 'a', { type: 'place', itemId: 'crate-a', expectedRevision: 1, targetId: 'fuse-socket' }).code).toBe('WRONG_TARGET');
  expect(g.snapshot().items[0]).toMatchObject({ state: 'CARRIED', revision: 1 });
  walk(g, w, 'a', TARGETS.find(t => t.id === 'decor-a')!.position);
  const request = { type: 'place', itemId: 'crate-a', expectedRevision: 1, targetId: 'decor-a', requestId: 'delivery', roundId: 1 };
  expect(g.intent('a', request).ok).toBe(true); expect(g.intent('a', request).ok).toBe(true);
  expect(g.intent('a', { ...request, requestId: 'again' }).code).toBe('STALE_REVISION');
  expect(g.snapshot().score).toBe(100);
});

it('bad messages and client-stamped time cannot bypass validation, rounds or input authority', async () => {
  const { g } = await setup();
  for (const raw of [null, [], {}, { type: 'finish' }, { type: 'ready', requestId: 'x', roundId: 1, ready: true, playerId: 'b' }]) expect(g.intent('a', raw).code).toBe('INVALID');
  for (const raw of [null, {}, { seq: 1, roundId: 1, x: 2, z: 0, sprint: true }, { seq: 2, roundId: 1, x: 1, z: 0, sprint: true, dt: 99 }, { seq: 3, roundId: 0, x: 1, z: 0, sprint: true }]) expect(g.input('a', raw)).toBe(false);
  expect(g.intent('intruder', { type: 'replay', requestId: 'bad', roundId: 1 }).code).toBe('NOT_CONNECTED');
  expect(g.snapshot().phase).toBe('supply'); expect(g.snapshot().score).toBe(0);
});

it('finished results freeze the round timer and progress while room time continues', async () => {
  const { g } = await setup();
  g.disconnect('a', true); g.tick(60001);
  expect(g.snapshot().result).toBe('alone');
  const before = g.snapshot();
  g.tick(5000);
  expect(g.snapshot().remainingMs).toBe(before.remainingMs);
  expect(g.snapshot().score).toBe(before.score);
  expect(g.snapshot().serverTimeMs).toBeGreaterThan(before.serverTimeMs);
});

it('does not count a stalled server interval toward the three-second continuous launch hold', async () => {
  const { g, w } = await setup(); supply(g, w);
  for (const [slot, symbol] of ['sun', 'leaf', 'wave'].entries()) deliver(g, w, `module-${symbol}`, `power-${slot}`);
  walk(g, w, 'a', TARGETS.find(t => t.id === 'station-a')!.position);
  walk(g, w, 'b', TARGETS.find(t => t.id === 'station-b')!.position);
  act(g, 'a', { type: 'hold', targetId: 'station-a', active: true });
  act(g, 'b', { type: 'hold', targetId: 'station-b', active: true });
  g.tick(3500);
  expect(g.snapshot()).toMatchObject({ phase: 'launch', launchProgressMs: 0, result: null });
});
