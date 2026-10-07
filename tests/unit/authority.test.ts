import { afterEach, describe, expect, it } from 'vitest';
import { Game } from '../../apps/server/src/domain.js';
import { CollisionWorld } from '../../packages/shared/src/movement.js';

const worlds: CollisionWorld[] = [];
afterEach(() => worlds.splice(0).forEach(w => w.dispose()));
async function fixture() {
  const world = await CollisionWorld.create(); worlds.push(world);
  const game = new Game(world, { layout: 0, clue: 0 });
  game.join('a', 'An'); game.join('b', 'Bình');
  game.intent('a', { type: 'ready', requestId: 'ra', roundId: 1, ready: true });
  game.intent('b', { type: 'ready', requestId: 'rb', roundId: 1, ready: true });
  game.intent('a', { type: 'start', requestId: 'start', roundId: 1 });
  return game;
}

describe('authority RED baseline', () => {
  it('input burst refills at 60/s, does not speed movement and exhausted invalid inputs spend budget', async () => {
    const g = await fixture();
    const frame = (seq: number) => ({ seq, roundId: 1, x: 0, z: 1, sprint: false });
    const before = g.snapshot().players[0]!.position;
    for (let i = 0; i < 90; i++) expect(g.input('a', frame(i))).toBe(true);
    expect(g.input('a', frame(90))).toBe(false);
    expect(g.snapshot().players[0]!.position).toEqual(before);
    g.tick(1000 / 60 + .001);
    expect(g.input('a', { malformed: true })).toBe(false);
    expect(g.input('a', frame(91))).toBe(false);
    g.tick(1000 / 60 + .001);
    expect(g.input('a', frame(92))).toBe(true); expect(g.input('a', frame(93))).toBe(false);
    expect(g.snapshot().players[0]!.position.z - before.z).toBeLessThan(.24);
  });
  it('bounds speed, blocks a wall, permits the storage doorway with the same Rapier simulation', async () => {
    const w = await CollisionWorld.create(); worlds.push(w);
    let p = { x: 0, y: 0, z: 4 };
    for (let i = 0; i < 30; i++) p = w.move(p, { x: -1, z: 0, sprint: false }, false);
    expect(p.x).toBeCloseTo(-3.5, 1);
    p = { x: -10, y: 0, z: 3 };
    for (let i = 0; i < 60; i++) p = w.move(p, { x: -1, z: 0, sprint: true }, false);
    expect(p.x).toBeGreaterThan(-11.6);
    p = { x: -10, y: 0, z: 0 };
    for (let i = 0; i < 30; i++) p = w.move(p, { x: -1, z: 0, sprint: false }, false);
    expect(p.x).toBeLessThan(-13);
  });
  it('starts only with ready teammates and creates the full mandatory inventory', async () => {
    const g = await fixture();
    expect(g.snapshot().phase).toBe('supply');
    expect(g.snapshot().items).toHaveLength(9);
    expect(g.snapshot().remainingMs).toBe(720000);
  });
  it('rejects a remote pickup without changing ownership or revision', async () => {
    const g = await fixture();
    const r = g.intent('a', { type: 'pickup', requestId: 'p1', roundId: 1, itemId: 'crate-a', expectedRevision: 0 });
    expect(r.code).toBe('OUT_OF_REACH');
    expect(g.snapshot().items.find(i => i.id === 'crate-a')).toMatchObject({ state: 'WORLD', revision: 0, holderId: null });
  });
  it('malformed messages consume the intent budget before a valid action can execute', async () => {
    const g = await fixture();
    for (let i = 0; i < 30; i++) expect(g.intent('a', { malformed: i }).code).toBe('INVALID');
    expect(g.intent('a', { type: 'ping', requestId: 'after-malformed', roundId: 1, targetId: 'a', preset: 'here' }).code).toBe('RATE_LIMIT');
    expect(g.snapshot().pings).toHaveLength(0);
    g.tick(1000);
    expect(g.intent('a', { type: 'ping', requestId: 'after-refill', roundId: 1, targetId: 'a', preset: 'here' }).code).toBe('OK');
  });
  it.each(['stale', 'conflict'] as const)('%s attempts spend the remaining burst without mutation; identical cached replies stay free', async kind => {
    const g = await fixture(); // a has spent two of 24 tokens.
    const cached = { type: 'pickup', requestId: 'cached-failure', roundId: 1, itemId: 'crate-a', expectedRevision: 0 };
    const response = g.intent('a', cached);
    const before = g.snapshot();
    for (let i = 0; i < 100; i++) expect(g.intent('a', cached)).toEqual(response);
    for (let i = 0; i < 21; i++) {
      const attempt = kind === 'stale' ? { ...cached, roundId: 0 } : { ...cached, itemId: 'crate-b' };
      expect(g.intent('a', attempt).code).toBe(kind === 'stale' ? 'OLD_ROUND' : 'REQUEST_CONFLICT');
    }
    expect(g.snapshot()).toEqual(before);
    expect(g.intent('a', { type: 'ping', requestId: 'exhausted', roundId: 1, targetId: 'a', preset: 'here' }).code).toBe('RATE_LIMIT');
    expect(g.intent('a', cached)).toEqual(response);
    expect(g.intent('a', { type: 'ready', requestId: 'ra', roundId: 1, ready: true }).code).toBe('OK');
    expect(g.snapshot()).toEqual(before); // cached ready cannot alter active state either.
    g.tick(1000 / 12 + .001);
    expect(g.intent('a', { type: 'ping', requestId: 'refilled', roundId: 1, targetId: 'a', preset: 'here' }).code).toBe('OK');
    expect(g.intent('a', { type: 'drop', requestId: 'spent-refill', roundId: 1, itemId: 'crate-a', expectedRevision: 0 }).code).toBe('RATE_LIMIT');
    expect(g.snapshot().items).toEqual(before.items);
    expect(g.snapshot().score).toBe(0);
  });
});
