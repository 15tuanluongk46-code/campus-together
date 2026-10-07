import { afterEach, expect, it } from 'vitest';
import { CollisionWorld } from '@campus/shared';
import { Game } from '../../apps/server/src/domain.js';
import { act, deliver, holding, launch, supply, target, walk } from '../helpers/domain.js';

const worlds: CollisionWorld[] = [];
afterEach(() => worlds.splice(0).forEach(w => w.dispose()));
async function setup(layout = 0) {
  const w = await CollisionWorld.create(); worlds.push(w);
  const g = new Game(w, { layout, clue: layout, mode: 'solo' });
  expect(g.join('a', 'An')).toBe(true);
  act(g, { type: 'ready', ready: true });
  expect(act(g, { type: 'start' }).code).toBe('OK');
  return { g, w };
}

it('solo starts with one ready player, refuses second seat, has 18 minutes and no alone ending', async () => {
  const { g } = await setup();
  expect(g.snapshot()).toMatchObject({ mode: 'solo', durationMs: 1080000, remainingMs: 1080000, soloRemainingMs: null });
  expect(g.join('b', 'Bình')).toBe(false);
  g.tick(61000); expect(g.snapshot()).toMatchObject({ phase: 'supply', remainingMs: 1019000, soloRemainingMs: null });
  g.tick(1019000); expect(g.snapshot()).toMatchObject({ phase: 'results', result: 'timeout', remainingMs: 0 });
  act(g, { type: 'replay' });
  expect(g.join('b', 'Bình')).toBe(false);
  expect(g.snapshot()).toMatchObject({ mode: 'solo', phase: 'supply', durationMs: 1080000 });
});

it.each([0, 1, 2])('solo completes layout %i with normal movement, both optional deliveries, A then B and clean replay', async layout => {
  const { g, w } = await setup(layout);
  launch(g, w);
  deliver(g, w, 'banner', 'banner-socket'); deliver(g, w, 'lantern', 'lantern-socket');
  expect(g.snapshot()).toMatchObject({ phase: 'launch', score: 800 });
  walk(g, w, target('station-b'));
  for (let i = 0; i < 100; i++) { if (i % 4 === 0) expect(act(g, { type: 'hold', targetId: 'station-b', active: true }).code).toBe('WRONG_ORDER'); g.tick(); }
  expect(g.snapshot()).toMatchObject({ launchProgressMs: 0, stationAComplete: false, phase: 'launch' });
  walk(g, w, target('station-a')); holding(g, 'station-a', 89);
  expect(g.snapshot().stationAComplete).toBe(false);
  holding(g, 'station-a', 1);
  expect(g.snapshot()).toMatchObject({ stationAComplete: true, phase: 'launch' });
  act(g, { type: 'hold', targetId: 'station-a', active: false });
  walk(g, w, target('station-b')); holding(g, 'station-b', 90);
  expect(g.snapshot()).toMatchObject({ phase: 'results', result: 'success', score: 1300, launchProgressMs: 3000 });
  const remaining = g.snapshot().remainingMs; g.tick(5000); expect(g.snapshot().remainingMs).toBe(remaining);
  expect(act(g, { type: 'replay' }).code).toBe('OK');
  expect(g.snapshot()).toMatchObject({ mode: 'solo', roundId: 2, layout: (layout + 1) % 3, phase: 'supply', score: 0, powerStep: 0, stationAComplete: false, launchProgressMs: 0, gateChargeMs: 0, gateRemainingMs: 0 });
  expect(g.clueFor('a')).toBeUndefined();
  expect(g.snapshot().items.every(i => i.state === 'WORLD' && i.revision === 0 && i.holderId === null)).toBe(true);
  expect(act(g, { type: 'start' }).code).toBe('WRONG_PHASE');
  expect(act(g, { type: 'ready', ready: true }).code).toBe('WRONG_PHASE');
});

it('solo gate requires continuous charge, release resets immediately and activation needs a fresh release', async () => {
  const { g, w } = await setup(); walk(g, w, target('gate-switch'));
  holding(g, 'gate-switch', 29); expect(g.snapshot().gateOpen).toBe(false);
  act(g, { type: 'hold', targetId: 'gate-switch', active: false });
  expect(g.snapshot().gateChargeMs).toBe(0);
  holding(g, 'gate-switch', 29); expect(g.snapshot().gateOpen).toBe(false);
  holding(g, 'gate-switch', 1); expect(g.snapshot().gateOpen).toBe(true); expect(g.snapshot().gateRemainingMs).toBeCloseTo(15000, 5);
  holding(g, 'gate-switch', 460); expect(g.snapshot()).toMatchObject({ gateOpen: false, gateRemainingMs: 0 });
  act(g, { type: 'hold', targetId: 'gate-switch', active: false }); holding(g, 'gate-switch', 30);
  expect(g.snapshot().gateRemainingMs).toBeCloseTo(15000, 5);
});

it('solo timed gate still protects a disconnected avatar in the doorway', async () => {
  const { g, w } = await setup(); walk(g, w, target('gate-switch')); holding(g, 'gate-switch', 30);
  act(g, { type: 'hold', targetId: 'gate-switch', active: false });
  walk(g, w, { x: 0, y: 0, z: 0 }); g.disconnect('a'); g.tick(15001);
  expect(g.snapshot()).toMatchObject({ gateOpen: true, gateRemainingMs: 0 });
  expect(g.reconnect('a')).toBe(true); walk(g, w, { x: 2, y: 0, z: 0 });
  expect(g.snapshot().gateOpen).toBe(false);
});

it('solo partial station charge resets on release, disconnect and expired heartbeat; A latch survives reconnect', async () => {
  const { g, w } = await setup(); launch(g, w); walk(g, w, target('station-a'));
  holding(g, 'station-a', 60); act(g, { type: 'hold', targetId: 'station-a', active: false });
  expect(g.snapshot().launchProgressMs).toBe(0);
  holding(g, 'station-a', 60); g.disconnect('a');
  expect(g.snapshot()).toMatchObject({ launchProgressMs: 0, stationAComplete: false });
  g.tick(1000); expect(g.reconnect('a')).toBe(true);
  holding(g, 'station-a', 60); g.tick(3500);
  expect(g.snapshot()).toMatchObject({ launchProgressMs: 0, stationAComplete: false });
  holding(g, 'station-a', 90); g.disconnect('a'); g.tick(1000); expect(g.reconnect('a')).toBe(true);
  expect(g.snapshot().stationAComplete).toBe(true);
  walk(g, w, target('station-b')); holding(g, 'station-b', 60); g.disconnect('a');
  g.tick(1000); expect(g.reconnect('a')).toBe(true);
  expect(g.snapshot()).toMatchObject({ launchProgressMs: 0, stationAComplete: true, phase: 'launch' });
  holding(g, 'station-b', 60); expect(g.snapshot().phase).toBe('launch');
  holding(g, 'station-b', 30); expect(g.snapshot().result).toBe('success');
});

it('solo clue is discoverable only at the board, retained privately for reconnect, and not in snapshots', async () => {
  const { g, w } = await setup();
  expect(g.clueFor('a')).toBeUndefined(); supply(g, w);
  expect(act(g, { type: 'read-clue' }).code).toBe('OUT_OF_REACH');
  expect(g.clueFor('a')).toBeUndefined();
  walk(g, w, target('clue-board')); expect(act(g, { type: 'read-clue' }).clue).toEqual(['sun', 'leaf', 'wave']);
  g.disconnect('a'); g.tick(1000); g.reconnect('a');
  expect(g.clueFor('a')).toEqual(['sun', 'leaf', 'wave']); expect(g.clueFor('intruder')).toBeUndefined();
  expect(g.snapshot()).not.toHaveProperty('clue');
});

it('picking up an item interrupts partial station work even if dropped and re-held before the next tick', async () => {
  const { g, w } = await setup(); launch(g, w);
  walk(g, w, g.snapshot().items.find(i => i.id === 'banner')!.position);
  expect(act(g, { type: 'pickup', itemId: 'banner', expectedRevision: 0 }).code).toBe('OK');
  walk(g, w, target('station-a'));
  expect(act(g, { type: 'hold', targetId: 'station-a', active: true }).code).toBe('HANDS_FULL');
  expect(act(g, { type: 'drop', itemId: 'banner', expectedRevision: 1 }).code).toBe('OK');
  holding(g, 'station-a', 60);
  expect(act(g, { type: 'pickup', itemId: 'banner', expectedRevision: 2 }).code).toBe('OK');
  expect(g.snapshot().launchProgressMs).toBe(0);
  expect(act(g, { type: 'drop', itemId: 'banner', expectedRevision: 3 }).code).toBe('OK');
  holding(g, 'station-a', 30); expect(g.snapshot().stationAComplete).toBe(false);
  walk(g, w, { x: 10, y: 0, z: 8 }); expect(g.snapshot().launchProgressMs).toBe(0);
});

it('solo gate full hands and invalid reach cannot charge, and moving away clears partial work', async () => {
  const { g, w } = await setup();
  expect(act(g, { type: 'hold', targetId: 'gate-switch', active: true }).code).toBe('OUT_OF_REACH');
  walk(g, w, g.snapshot().items[0]!.position); act(g, { type: 'pickup', itemId: 'crate-a', expectedRevision: 0 });
  walk(g, w, target('gate-switch'));
  expect(act(g, { type: 'hold', targetId: 'gate-switch', active: true }).code).toBe('HANDS_FULL');
  expect(act(g, { type: 'drop', itemId: 'crate-a', expectedRevision: 1 }).code).toBe('OK');
  holding(g, 'gate-switch', 10); walk(g, w, { x: -8, y: 0, z: 0 });
  expect(g.snapshot()).toMatchObject({ gateChargeMs: 0, gateOpen: false });
});

it('solo item drops once at 3s and reconnect cannot resurrect an old pickup; voluntary leave removes the seat', async () => {
  const { g, w } = await setup(); walk(g, w, g.snapshot().items[0]!.position);
  const request = { type: 'pickup', itemId: 'crate-a', expectedRevision: 0, roundId: 1, requestId: 'same' };
  expect(g.intent('a', request).code).toBe('OK'); g.disconnect('a'); g.tick(2999);
  expect(g.snapshot().items[0]!.state).toBe('CARRIED'); g.tick(1);
  expect(g.snapshot().items[0]).toMatchObject({ state: 'WORLD', holderId: null, revision: 2 });
  expect(g.reconnect('a')).toBe(true); expect(g.intent('a', request).code).toBe('OK');
  expect(g.snapshot().players[0]!.heldItemId).toBeNull(); expect(g.snapshot().items[0]!.revision).toBe(2);
  g.disconnect('a', true); expect(g.snapshot().players).toHaveLength(0); expect(g.reconnect('a')).toBe(false);
});
