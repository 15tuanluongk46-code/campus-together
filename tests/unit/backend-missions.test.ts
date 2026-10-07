import { afterEach, expect, it } from 'vitest';
import { CollisionWorld, STEP_MS } from '@campus/shared';
import { Game } from '../../apps/server/src/domain.js';
import { act, holding, launch, target, walk } from '../helpers/domain.js';

const worlds: CollisionWorld[] = [];
afterEach(() => worlds.splice(0).forEach(w => w.dispose()));
async function setup(count: number) {
  const w = await CollisionWorld.create(); worlds.push(w);
  const g = new Game(w, { layout: 0, clue: 0, mode: count === 1 ? 'solo' : 'coop' });
  for (const id of ['a', 'b', 'c', 'd'].slice(0, count)) { g.join(id, id); act(g, { type: 'ready', ready: true }, id); }
  act(g, { type: 'start' }); return { g, w };
}
const pulse = (g: Game, id: string, station: 'station-a' | 'station-b') => {
  expect(act(g, { type: 'hold', targetId: station, active: true }, id).code).toBe('OK');
};
type Interruption = 'release' | 'expiry' | 'disconnect' | 'pickup' | 'reach';
for (const count of [3, 4]) for (const contributor of [false, true]) {
  it.each<Interruption>(['release', 'expiry', 'disconnect', 'pickup', 'reach'])(`${count} players: ${contributor ? 'contributor resets' : 'redundant preserves'} stable pair on %s`, async kind => {
    const { g, w } = await setup(count); launch(g, w);
    // A is deliberately the earlier Map entry, but C starts contributing first.
    // Selecting find(station) anew every tick would incorrectly replace C with A.
    walk(g, w, g.snapshot().items.find(i => i.id === 'banner')!.position);
    act(g, { type: 'pickup', itemId: 'banner', expectedRevision: 0 });
    walk(g, w, target('station-a')); act(g, { type: 'drop', itemId: 'banner', expectedRevision: 1 });
    walk(g, w, target('station-a'), 'c'); walk(g, w, target('station-b'), 'b');
    if (count === 4) walk(g, w, target('station-b'), 'd');
    const beat = (ticks: number, omitted?: string) => {
      for (let i = 0; i < ticks; i++) {
        if (i % 4 === 0) for (const [id, station] of [['c', 'station-a'], ['b', 'station-b'], ['a', 'station-a'], ...(count === 4 ? [['d', 'station-b']] : [])]) {
          if (id !== omitted) pulse(g, id!, station as 'station-a' | 'station-b');
        }
        g.tick();
      }
    };
    pulse(g, 'c', 'station-a'); pulse(g, 'b', 'station-b'); g.tick();
    beat(44); expect(g.snapshot().launchProgressMs).toBeCloseTo(1500, 5);
    const id = contributor ? 'c' : 'a';
    if (kind === 'release') act(g, { type: 'hold', targetId: 'station-a', active: false }, id);
    if (kind === 'disconnect') g.disconnect(id);
    if (kind === 'pickup') expect(act(g, { type: 'pickup', itemId: 'banner', expectedRevision: 2 }, id).code).toBe('OK');
    if (kind === 'expiry') beat(13, id);
    if (kind === 'reach') {
      for (let i = 0; i < 14; i++) {
        const player = g.snapshot().players.find(p => p.id === id)!;
        g.input(id, { seq: player.ackSeq + 1, roundId: 1, x: -1, z: 0, sprint: true });
        if (i % 4 === 0) { pulse(g, 'b', 'station-b'); pulse(g, contributor ? 'a' : 'c', 'station-a'); }
        g.tick();
      }
    }
    const progress = g.snapshot().launchProgressMs;
    if (contributor) expect(progress).toBeLessThan(500);
    else expect(progress).toBeGreaterThan(1500 - 1e-6);
    // A release/repress within a tick must not inherit the previous contribution.
    if (kind === 'release') pulse(g, id, 'station-a');
    const ticksLeft = Math.ceil((3000 - progress) / STEP_MS - 1e-6);
    for (let i = 0; i < ticksLeft - 1; i++) {
      if (i % 4 === 0) { pulse(g, contributor ? 'a' : 'c', 'station-a'); pulse(g, 'b', 'station-b'); }
      g.tick();
    }
    expect(g.phase).toBe('launch');
    pulse(g, contributor ? 'a' : 'c', 'station-a'); pulse(g, 'b', 'station-b'); g.tick();
    expect(g.snapshot()).toMatchObject({ phase: 'results', result: 'success', launchProgressMs: 3000 });
    const leader = g.snapshot().leaderId!; act(g, { type: 'replay' }, leader);
    expect(g.snapshot()).toMatchObject({ phase: 'lobby', launchProgressMs: 0 });
  });
}

it.each([false, true])('timeout clears gate %s (partial charge or active countdown)', async opened => {
  const { g, w } = await setup(1); walk(g, w, target('gate-switch'));
  g.tick(g.snapshot().remainingMs - 600);
  // Charge is step-bounded; place the deadline just after charge/activation.
  if (opened) {
    // Use a fresh game with enough time to open, then finish while it is active.
    const fresh = await setup(1); walk(fresh.g, fresh.w, target('gate-switch'));
    fresh.g.tick(fresh.g.snapshot().remainingMs - 1100); holding(fresh.g, 'gate-switch', 30);
    expect(fresh.g.snapshot().gateRemainingMs).toBeGreaterThan(0); fresh.g.tick(101);
    expect(fresh.g.snapshot()).toMatchObject({ phase: 'results', gateOpen: false, gateRemainingMs: 0, gateChargeMs: 0 });
  } else {
    holding(g, 'gate-switch', 10); expect(g.snapshot().gateChargeMs).toBeGreaterThan(0);
    g.tick(300); expect(g.snapshot()).toMatchObject({ phase: 'results', gateOpen: false, gateRemainingMs: 0, gateChargeMs: 0 });
  }
});
