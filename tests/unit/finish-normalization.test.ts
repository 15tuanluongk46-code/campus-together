import { afterEach, expect, it } from 'vitest';
import { CollisionWorld } from '@campus/shared';
import { finish } from '../../apps/server/src/missions.js';
import { join, newState } from '../../apps/server/src/sessions.js';

const worlds: CollisionWorld[] = [];
afterEach(() => worlds.splice(0).forEach(w => w.dispose()));
it.each(['success', 'timeout', 'alone'] as const)('%s finish normalizes all gate and pair bookkeeping once', async reason => {
  const world = await CollisionWorld.create(); worlds.push(world);
  const state = newState(0, 0); const ctx = { state, world }; join(ctx, 'a', 'A');
  // Unit fixture at the mission boundary; integration rounds use real movement.
  Object.assign(state, { phase: 'launch', gateOpen: true, gateUntil: 15000, gateChargeMs: 800, launchPair: { a: 'a', b: 'b' } });
  state.players.get('a')!.gateNeedsRelease = true;
  finish(ctx, reason); finish(ctx, reason);
  expect(state).toMatchObject({ phase: 'results', result: reason, gateOpen: false, gateUntil: 0, gateChargeMs: 0, launchPair: null, score: reason === 'success' ? 500 : 0 });
  expect(state.players.get('a')).toMatchObject({ holdTarget: null, gateNeedsRelease: false });
});
