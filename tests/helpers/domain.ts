import { expect } from 'vitest';
import { CollisionWorld, distance, TARGETS, type Intent, type Vec3 } from '@campus/shared';
import { Game } from '../../apps/server/src/domain.js';
import { route } from './navigation.js';

type Action = Intent extends infer T ? T extends Intent ? Omit<T, 'requestId' | 'roundId'> : never : never;
let request = 0;
export function act(g: Game, body: Action, id = 'a') {
  return g.intent(id, { ...body, requestId: `test-${++request}`, roundId: g.snapshot().roundId });
}
export function walk(g: Game, w: CollisionWorld, to: Vec3, id = 'a') {
  const player = () => g.snapshot().players.find(p => p.id === id)!;
  for (const waypoint of route(w, player().position, to)) {
    let ticks = 0;
    while (distance(player().position, waypoint) > .12) {
      if (++ticks > 600) throw new Error(`Blocked route to ${JSON.stringify(waypoint)}`);
      const p = player(), d = distance(p.position, waypoint);
      expect(g.input(id, { seq: p.ackSeq + 1, roundId: g.snapshot().roundId, x: (waypoint.x - p.position.x) / Math.max(d, .2), z: (waypoint.z - p.position.z) / Math.max(d, .2), sprint: true })).toBe(true);
      g.tick();
    }
  }
  g.input(id, { seq: player().ackSeq + 1, roundId: g.snapshot().roundId, x: 0, z: 0, sprint: false }); g.tick();
}
export const target = (id: string) => TARGETS.find(t => t.id === id)!.position;
export function deliver(g: Game, w: CollisionWorld, itemId: string, targetId: string) {
  const item = () => g.snapshot().items.find(i => i.id === itemId)!;
  walk(g, w, item().position);
  expect(act(g, { type: 'pickup', itemId, expectedRevision: item().revision }).code).toBe('OK');
  walk(g, w, target(targetId));
  const request = { type: 'place', itemId, expectedRevision: item().revision, targetId } as const;
  expect(act(g, request).code).toBe('OK');
  expect(act(g, request).code).toBe('STALE_REVISION');
}
export function supply(g: Game, w: CollisionWorld) {
  for (const [item, socket] of [['crate-a', 'decor-a'], ['crate-b', 'decor-b'], ['cable', 'cable-socket'], ['fuse', 'fuse-socket']] as const) deliver(g, w, item, socket);
}
export function launch(g: Game, w: CollisionWorld) {
  supply(g, w); walk(g, w, target('clue-board'));
  const clue = act(g, { type: 'read-clue' }).clue!;
  for (const [slot, symbol] of clue.entries()) deliver(g, w, `module-${symbol}`, `power-${slot}`);
}
export function holding(g: Game, targetId: 'gate-switch' | 'station-a' | 'station-b', ticks: number) {
  for (let i = 0; i < ticks; i++) {
    if (i % 4 === 0) expect(act(g, { type: 'hold', targetId, active: true }).code).toBe('OK');
    g.tick();
  }
}
