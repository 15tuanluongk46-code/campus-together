import { afterEach, expect, it, vi } from 'vitest';
import { CollisionWorld } from '@campus/shared';
import { CampusRoom } from '../../apps/server/src/room.js';
vi.mock('node:crypto', async importOriginal => {
  const original = await importOriginal<typeof import('node:crypto')>();
  return { ...original, randomInt: vi.fn(original.randomInt) };
});
import { randomInt } from 'node:crypto';
const rooms: CampusRoom[] = [];
afterEach(() => { for (const r of rooms.splice(0)) { r.clock.clear(); r.onDispose(); } vi.restoreAllMocks(); });
function room() {
  const r = new CampusRoom(); rooms.push(r);
  vi.spyOn(r, 'setPrivate').mockResolvedValue();
  // Avoid background timers in a lifecycle fault test. Collision/Game stay real.
  vi.spyOn(r, 'setSimulationInterval').mockImplementation(() => {});
  vi.spyOn(r, 'setPatchRate').mockImplementation(() => {});
  return r;
}
it('failed setPrivate releases allocated code before a new room tries that same candidate', async () => {
  let calls = 0;
  vi.mocked(randomInt).mockImplementation((() => ++calls <= 16 ? 0 : 1) as typeof randomInt);
  const failed = room(); vi.mocked(failed.setPrivate).mockRejectedValueOnce(new Error('listing unavailable'));
  await expect(failed.onCreate({ name: 'A', protocol: 1 })).rejects.toThrow('listing unavailable');
  const next = room(); await next.onCreate({ name: 'B', protocol: 1 });
  expect(next.roomId).toBe(failed.roomId);
});
it('failure after collision acquisition frees the world exactly once, including later onDispose', async () => {
  const dispose = vi.spyOn(CollisionWorld.prototype, 'dispose');
  const r = room(); vi.mocked(r.setSimulationInterval).mockImplementationOnce(() => { throw new Error('scheduler unavailable'); });
  await expect(r.onCreate({ name: 'A', protocol: 1 })).rejects.toThrow('scheduler unavailable');
  expect(dispose).toHaveBeenCalledTimes(1);
  r.onDispose(); expect(dispose).toHaveBeenCalledTimes(1);
});
