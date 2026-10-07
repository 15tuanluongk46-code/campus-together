import { expect, type Page } from '@playwright/test';
import { decode } from '@colyseus/schema';
import { unpack } from 'msgpackr';
import { CollisionWorld, distance, type GameSnapshot, type Welcome, type Vec3, type InputFrame } from '@campus/shared';
import { route } from '../helpers/navigation.js';
export function observe(page: Page) {
  const view: { snapshot?: GameSnapshot; welcome?: Welcome; input?: InputFrame; sent: { type: string; data: any; at: number }[]; frames: number; bytes: number; errors: string[]; warnings: string[] } = { sent: [], frames: 0, bytes: 0, errors: [], warnings: [] };
  page.on('pageerror', e => view.errors.push(e.message));
  page.on('console', msg => { if (msg.type() === 'error') view.errors.push(msg.text()); if (msg.type() === 'warning') view.warnings.push(msg.text()); });
  page.on('websocket', ws => ws.on('framereceived', ({ payload }) => {
    if (typeof payload === 'string' || payload[0] !== 13) return;
    const iterator = { offset: 1 }; const type = decode.stringCheck(payload, iterator) ? decode.string(payload, iterator) : decode.number(payload, iterator);
    if (type === 'snapshot') { view.snapshot = unpack(payload.subarray(iterator.offset)) as GameSnapshot; view.frames++; view.bytes += payload.length; }
    if (type === 'welcome') view.welcome = unpack(payload.subarray(iterator.offset)) as Welcome;
  }));
  page.on('websocket', ws => ws.on('framesent', ({ payload }) => {
    if (typeof payload === 'string' || payload[0] !== 13) return;
    const iterator = { offset: 1 }; const type = decode.stringCheck(payload, iterator) ? decode.string(payload, iterator) : decode.number(payload, iterator);
    if (type === 'input') view.input = unpack(payload.subarray(iterator.offset)) as InputFrame;
    view.sent.push({ type: String(type), data: unpack(payload.subarray(iterator.offset)), at: Date.now() });
  }));
  return view;
}
export async function enter(page: Page, name: string, room?: string) {
  await page.goto(room ? `/?room=${room}` : '/'); await page.waitForLoadState('networkidle');
  await expect(page.getByRole('button', { name: /Tạo phòng cùng bạn/ })).toBeEnabled({ timeout: 60000 });
  await page.getByLabel('Bạn tên là gì?').fill(name);
  await page.getByRole('button', { name: room ? 'Tham gia phòng' : /Tạo phòng cùng bạn/ }).click();
  await expect(page.getByRole('heading', { name: 'Nhóm của chúng mình' })).toBeVisible();
}
export async function walk(page: Page, view: ReturnType<typeof observe>, world: CollisionWorld, target: Vec3) {
  const me = () => view.snapshot!.players.find(p => p.id === view.welcome!.playerId)!;
  const plannedGate = view.snapshot!.gateOpen;
  world.setGate(plannedGate);
  const path = route(world, me().position, target);
  // All movement comes through actual browser keys with initial camera yaw=0.
    for (const point of path) {
      const deadline = Date.now() + 60000;
      // Stop near the actual item, not merely somewhere in its reach circle: a
      // different interactable (notably the clue board) can be nearer there.
      while (distance(me().position, point) > (point === path.at(-1) ? .4 : .55)) {
        // The timed Solo gate can close during a route: replan from the observed feet.
        if (view.snapshot!.gateOpen !== plannedGate) return walk(page, view, world, target);
        if (Date.now() > deadline) throw new Error(`Keyboard walker stuck ${JSON.stringify(me().position)} -> ${JSON.stringify(point)} input=${JSON.stringify(view.input)}`);
        const dx = point.x - me().position.x, dz = point.z - me().position.z;
        let horizontal = Math.abs(dx) > Math.abs(dz);
        const probe = world.move(me().position, { x: horizontal ? Math.sign(dx) : 0, z: horizontal ? 0 : Math.sign(dz), sprint: false }, false);
        if (distance(probe, me().position) < .03) horizontal = !horizontal;
        const key = horizontal ? dx > 0 ? 'KeyD' : 'KeyA' : dz > 0 ? 'KeyS' : 'KeyW';
        // Bounded pulses tolerate CDP delays under software WebGL without overshooting walls.
        await page.keyboard.press(key, { delay: Math.min(230, Math.max(20, Math.max(Math.abs(dx), Math.abs(dz)) / 3.5 * 300)) });
        await expect.poll(() => !!view.input && view.input.x === 0 && view.input.z === 0).toBe(true);
        const seq = view.input!.seq;
        await expect.poll(() => me().ackSeq >= seq).toBe(true);
      }
    }
}
