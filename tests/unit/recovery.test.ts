import { expect, it, vi } from 'vitest';
import { CollisionWorld, inBounds } from '../../packages/shared/src/movement.js';
import { newState, resetRound } from '../../apps/server/src/sessions.js';
import { recoverItems } from '../../apps/server/src/items.js';

it('recovers corrupted out-of-bounds world items with stable identity and a new revision', async () => {
  const world = await CollisionWorld.create();
  try {
    // Pure domain fixture, not a network-accessible debug method.
    const state = newState(0, 0); const ctx = { state, world }; resetRound(ctx, true);
    const item = state.items.get('crate-a')!; item.position = { x: 900, y: -20, z: 900 };
    recoverItems(ctx);
    expect(item.id).toBe('crate-a'); expect(item.revision).toBe(1);
    expect(item.state).toBe('WORLD'); expect(inBounds(item.position)).toBe(true);
    expect(world.isFree(item.position, .36, true)).toBe(true);
  } finally { world.dispose(); }
});

it('never returns an undefined-shaped recovery point when every candidate is blocked', async () => {
  const world = await CollisionWorld.create();
  try {
    vi.spyOn(world, 'isFree').mockReturnValue(false);
    expect(() => world.recovery({ x: NaN, y: 0, z: Infinity })).toThrow(/recovery/i);
  } finally { world.dispose(); }
});

it('searches beyond an occupied first recovery region without overlapping another item', async () => {
  const world = await CollisionWorld.create();
  try {
    const state = newState(0, 0); const ctx = { state, world }; resetRound(ctx, true);
    const item = state.items.get('crate-a')!; item.position = { x: -900, y: 0, z: 0 };
    const base = world.recovery(item.position);
    // Corrupted-state fixture occupies every candidate of the original small radial search.
    for (const radius of [0, 1, 2, 3]) for (let i = 0; i < 8; i++) {
      const id = `occupied-${radius}-${i}`;
      state.items.set(id, { ...item, id, position: { x: base.x + Math.sin(i * Math.PI / 4) * radius, y: 0, z: base.z + Math.cos(i * Math.PI / 4) * radius } });
    }
    recoverItems(ctx);
    expect(world.isFree(item.position, .36, true)).toBe(true);
    for (const other of state.items.values()) if (other.id !== item.id && other.state === 'WORLD') expect(Math.hypot(item.position.x - other.position.x, item.position.z - other.position.z)).toBeGreaterThanOrEqual(.72);
  } finally { world.dispose(); }
});
