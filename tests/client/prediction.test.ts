import { afterAll, beforeAll, expect, it } from 'vitest';
import { CollisionWorld } from '@campus/shared';
import { Predictor, interpolatePlayer, cameraDistance } from '../../apps/client/src/prediction.js';
import { player, snapshot } from './fixtures.js';
let world: CollisionWorld;
beforeAll(async () => { world = await CollisionWorld.create(); }); afterAll(() => world.dispose());
it('reconciles using ack, bounds pending input, preserves seq on reconnect and resets on replay', () => {
  const p = new Predictor(world); const s = snapshot({ players: [player({ position: { x: -8, y: 0, z: 0 } })] });
  p.accept(s, 'me', false); const frame = p.step({ x: 1, z: 0, sprint: false }, false)!;
  expect(frame.seq).toBe(0); expect(p.position.x).toBeGreaterThan(-8);
  s.players[0]!.ackSeq = 0; p.accept(s, 'me', false); expect(p.position.x).toBe(-8);
  p.accept(s, 'me', true); expect(p.step({ x: 0, z: 0, sprint: false }, false)!.seq).toBe(1);
  for (let i = 0; i < 200; i++) p.step({ x: 0, z: 0, sprint: false }, false);
  expect(p.pending.length).toBeLessThanOrEqual(60);
  s.roundId = 2; s.players[0]!.ackSeq = -1; p.accept(s, 'me', false);
  expect(p.step({ x: 0, z: 0, sprint: false }, false)!.seq).toBe(0);
});
it('remote interpolation interpolates angle across wrap and clamps missing packets', () => {
  const a = player({ facing: Math.PI - .1, position: { x: 0, y: 0, z: 0 } });
  const b = player({ facing: -Math.PI + .1, position: { x: 2, y: 0, z: 0 } });
  expect(interpolatePlayer(a, b, .5).position.x).toBe(1);
  expect(Math.abs(interpolatePlayer(a, b, .5).facing)).toBeCloseTo(Math.PI);
  expect(interpolatePlayer(a, b, 8).position.x).toBe(2);
});
it('camera sweep stops before shared wall with clearance, but ignores an open gate', () => {
  const a = { x: -2, y: 1, z: 0 }, b = { x: 2, y: 1, z: 0 };
  expect(cameraDistance(a, b, false)).toBeLessThan(1.8);
  expect(cameraDistance(a, b, true)).toBe(4);
});
