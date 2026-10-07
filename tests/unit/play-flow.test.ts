import { afterEach, expect, it } from 'vitest';
import { CollisionWorld } from '@campus/shared';
import { Game } from '../../apps/server/src/domain.js';
import { act, holding, launch, supply, target, walk } from '../helpers/domain.js';
import { contextAction } from '../../apps/client/src/model.js';

const worlds: CollisionWorld[] = [];
afterEach(() => worlds.splice(0).forEach(w => w.dispose()));
async function setup() {
  const w = await CollisionWorld.create(); worlds.push(w);
  const g = new Game(w, { mode: 'solo', layout: 0, clue: 0 });
  g.join('a', 'An'); act(g, { type: 'ready', ready: true }); act(g, { type: 'start' });
  return { g, w };
}
it('full hands block board reads on server and context with the same drop guidance', async () => {
  const { g, w } = await setup(); supply(g, w);
  const item = g.snapshot().items.find(i => i.id === 'module-sun')!;
  walk(g, w, item.position); act(g, { type: 'pickup', itemId: item.id, expectedRevision: item.revision });
  walk(g, w, target('clue-board'));
  const reply = act(g, { type: 'read-clue' });
  expect(reply.code).toBe('HANDS_FULL'); expect(reply.message).toContain('G');
  expect(g.clueFor('a')).toBeUndefined(); expect(g.snapshot().players[0]!.heldItemId).toBe(item.id);
  const context = contextAction(g.snapshot(), 'a', (a, b) => w.hasLineOfSight(a, b));
  expect(context).toMatchObject({ status: 'blocked', hold: false, intent: null, label: reply.message });
});
it('Solo B-before-A rejects direct holds with contextual guidance; completed A never recharges', async () => {
  const { g, w } = await setup(); launch(g, w); walk(g, w, target('station-b'));
  const before = act(g, { type: 'hold', targetId: 'station-b', active: true });
  expect(before.code).toBe('WRONG_ORDER'); expect(before.message).toContain('trạm A');
  expect(contextAction(g.snapshot(), 'a', () => true)).toMatchObject({ status: 'blocked', hold: false, intent: null, label: before.message });
  expect(g.snapshot().players[0]!.holdTarget).toBeNull();
  walk(g, w, target('station-a')); holding(g, 'station-a', 90);
  const completed = act(g, { type: 'hold', targetId: 'station-a', active: true });
  expect(completed.code).toBe('OCCUPIED'); expect(completed.message).toContain('trạm B');
  expect(contextAction(g.snapshot(), 'a', () => true)).toMatchObject({ status: 'completed', intent: null, hold: false, label: completed.message });
  g.tick(); expect(g.snapshot()).toMatchObject({ stationAComplete: true, launchProgressMs: 0 });
});
it('Solo replay atomically resets inventory, clue, input and timer and starts exactly once across old/repeated requests', async () => {
  const { g, w } = await setup(); launch(g, w); walk(g, w, target('station-a')); holding(g, 'station-a', 90);
  const banner = g.snapshot().items.find(i => i.id === 'banner')!;
  walk(g, w, banner.position); act(g, { type: 'pickup', itemId: banner.id, expectedRevision: 0 });
  g.tick(1080000); expect(g.phase).toBe('results');
  const old = g.snapshot(); const request = { type: 'replay', requestId: 'replay-once', roundId: old.roundId };
  expect(g.intent('a', request)).toMatchObject({ ok: true, roundId: 2 });
  const fresh = g.snapshot();
  expect(fresh).toMatchObject({ phase: 'supply', roundId: 2, score: 0, powerStep: 0, launchProgressMs: 0, stationAComplete: false, gateOpen: false, gateRemainingMs: 0, result: null, pings: [] });
  expect(fresh.remainingMs).toBeCloseTo(1080000, 5);
  expect(fresh.players[0]).toMatchObject({ heldItemId: null, holdTarget: null, ackSeq: -1, moving: false });
  expect(fresh.items.every(i => i.state === 'WORLD' && i.revision === 0 && i.targetId === null && i.holderId === null)).toBe(true);
  expect(fresh.targets.every(t => t.itemId === null)).toBe(true); expect(g.clueFor('a')).toBeUndefined();
  expect(g.intent('a', request).code).toBe('OLD_ROUND');
  expect(g.intent('a', { ...request, requestId: 'late-new-id' }).code).toBe('OLD_ROUND');
  expect(act(g, { type: 'replay' }).code).toBe('WRONG_PHASE'); expect(g.snapshot()).toEqual(fresh);
  expect(g.input('a', { roundId: 1, seq: 999999, x: 1, z: 0, sprint: true })).toBe(false);
  expect(g.input('a', { roundId: 2, seq: 0, x: 0, z: 0, sprint: false })).toBe(true);
  g.tick(1000); expect(g.snapshot().remainingMs).toBeCloseTo(1079000, 5);
  expect(g.intent('a', request).code).toBe('OLD_ROUND'); expect(g.snapshot().remainingMs).toBeCloseTo(1079000, 5);
});
it('symbol pings cannot be sent directly outside power while ordinary pings still work', async () => {
  const { g } = await setup();
  expect(act(g, { type: 'ping', targetId: 'clue-board', preset: 'sun' }).code).toBe('WRONG_PHASE');
  expect(g.snapshot().pings).toEqual([]);
  expect(act(g, { type: 'ping', targetId: 'a', preset: 'here' }).code).toBe('OK');
});
