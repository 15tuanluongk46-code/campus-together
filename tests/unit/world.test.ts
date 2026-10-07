import { afterEach, expect, it } from 'vitest';
import { CollisionWorld, distance, reconcile } from '../../packages/shared/src/movement.js';
import { COLLIDERS, ITEM_LAYOUTS, SPAWNS, TARGETS } from '../../packages/shared/src/world.js';
import { route } from '../helpers/navigation.js';

const worlds: CollisionWorld[] = [];
afterEach(() => worlds.splice(0).forEach(w => w.dispose()));
async function world() { const w = await CollisionWorld.create(); worlds.push(w); return w; }

it.each([0, 1, 2, 3])('all items/layouts and interactables are reachable on foot from spawn %i with gate CLOSED', async spawn => {
  const w = await world();
  for (const to of [...ITEM_LAYOUTS.flat().map(i => i.position), ...TARGETS.map(t => t.position)]) {
    let p = { ...SPAWNS[spawn]! };
    expect(w.isFree(to, .4)).toBe(true);
    for (const waypoint of route(w, p, to)) {
      let ticks = 0;
      while (distance(p, waypoint) > .1) {
        expect(++ticks, `blocked route to ${JSON.stringify(to)}`).toBeLessThan(700);
        const d = distance(p, waypoint);
        p = w.move(p, { x: (waypoint.x - p.x) / Math.max(d, .2), z: (waypoint.z - p.z) / Math.max(d, .2), sprint: true }, true);
      }
    }
    expect(distance(p, to)).toBeLessThan(1.6);
    expect(w.hasLineOfSight(p, to)).toBe(true);
  }
});

it('gate shortcut materially reduces travel, while closed gate blocks capsule and LOS', async () => {
  const w = await world(); const start = { x: -3, y: 0, z: 0 }; const end = { x: 3, y: 0, z: 0 };
  const path = route(w, start, end);
  const length = path.slice(1).reduce((sum, p, i) => sum + distance(path[i]!, p), 0);
  expect(length).toBeGreaterThan(20);
  let p = start;
  for (let i = 0; i < 60; i++) p = w.move(p, { x: 1, z: 0, sprint: false }, false);
  expect(p.x).toBeLessThan(-.49); expect(w.hasLineOfSight(start, end)).toBe(false);
  w.setGate(true); p = start;
  for (let i = 0; i < 60; i++) p = w.move(p, { x: 1, z: 0, sprint: false }, false);
  expect(p.x).toBeGreaterThan(3.9); expect(w.hasLineOfSight(start, end)).toBe(true);
  expect(w.isFree({ x: 0, y: 0, z: 0 }, .36, true)).toBe(false);
});

it('shared predictor removes acknowledged movement and respects wall collision', async () => {
  const w = await world();
  const pending = [1, 2, 3].map(seq => ({ seq, input: { x: 1, z: 0, sprint: false }, carryingCrate: false }));
  const p = reconcile(w, { x: -3, y: 0, z: 0 }, 1, pending);
  expect(p.x).toBeCloseTo(-3 + 7 / 30, 4);
  const blocked = reconcile(w, { x: -.52, y: 0, z: 0 }, 0, pending);
  expect(blocked.x).toBeLessThan(-.49);
  expect(COLLIDERS.every(c => c.half.x > 0 && c.half.y > 0 && c.half.z > 0)).toBe(true);
});

it('map edge collision prevents leaving the playable ground at high sustained input', async () => {
  const w = await world(); let p = { x: 22, y: 0, z: 15 };
  for (let i = 0; i < 600; i++) p = w.move(p, { x: 999, z: 999, sprint: true }, false);
  expect(p.x).toBeLessThan(23.7); expect(p.z).toBeLessThan(17.7);
  expect(w.isFree({ x: 25, y: 0, z: 0 })).toBe(false);
});
