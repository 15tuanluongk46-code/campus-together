import { distance, inBounds, TARGETS } from '@campus/shared';
import type { ErrorCode, Intent, ItemSnapshot, Vec3 } from '@campus/shared';
import type { DomainContext, Player } from './model.js';
import { reach } from './validation.js';
import { clearHold } from './missions.js';

function clearHand(player: Player, item: ItemSnapshot): void { player.heldItemId = null; item.holderId = null; item.revision++; }
function safe(ctx: DomainContext, position: Vec3, itemId: string): boolean {
  return ctx.world.isFree(position, .36, true) && ![...ctx.state.items.values()].some(i => i.id !== itemId && i.state === 'WORLD' && distance(position, i.position) < .72);
}
export function drop(ctx: DomainContext, player: Player, forced = false): ErrorCode {
  const item = ctx.state.items.get(player.heldItemId ?? '');
  if (!item) return 'NOT_HOLDER';
  const destination = { x: player.position.x + Math.sin(player.facing) * .85, y: 0, z: player.position.z + Math.cos(player.facing) * .85 };
  let position: Vec3 = destination;
  if (!safe(ctx, destination, item.id) || !ctx.world.hasLineOfSight(player.position, destination)) {
    if (!forced) return 'UNSAFE_DROP';
    position = { ...player.position };
    if (!safe(ctx, position, item.id)) position = recover(ctx, item);
  }
  clearHand(player, item); item.state = 'WORLD'; item.position = position; item.targetId = null;
  return 'OK';
}
function recover(ctx: DomainContext, item: ItemSnapshot): Vec3 {
  return ctx.world.recovery(item.position, p => safe(ctx, p, item.id));
}
export function recoverItems(ctx: DomainContext): void {
  for (const item of ctx.state.items.values()) {
    if (item.state === 'WORLD' && !inBounds(item.position, .36)) {
      item.position = recover(ctx, item); item.revision++;
    }
  }
}
export function itemIntent(ctx: DomainContext, player: Player, intent: Extract<Intent, { type: 'pickup' | 'drop' | 'place' }>): ErrorCode {
  const { state } = ctx;
  const item = state.items.get(intent.itemId);
  if (!item) return 'UNKNOWN_ITEM';
  if (intent.expectedRevision !== item.revision) return 'STALE_REVISION';
  if (intent.type === 'pickup') {
    if (player.heldItemId) return 'HANDS_FULL';
    if (item.state !== 'WORLD') return 'NOT_WORLD';
    if (item.kind === 'module' && state.phase !== 'power') return 'WRONG_PHASE';
    const code = reach(ctx, player, item.position); if (code !== 'OK') return code;
    item.state = 'CARRIED'; item.holderId = player.id; item.revision++; player.heldItemId = item.id;
    item.position = { ...player.position }; clearHold(ctx, player);
    return 'OK';
  }
  if (item.state !== 'CARRIED' || item.holderId !== player.id || player.heldItemId !== item.id) return 'NOT_HOLDER';
  if (intent.type === 'drop') return drop(ctx, player);
  const target = TARGETS.find(t => t.id === intent.targetId);
  if (!target || target.kind !== item.kind) return 'WRONG_TARGET';
  if (target.phase !== 'any' && target.phase !== state.phase) return 'WRONG_PHASE';
  const code = reach(ctx, player, target.position); if (code !== 'OK') return code;
  if (state.targets.get(target.id)) return 'OCCUPIED';
  if (item.kind === 'module' && (target.slot !== state.powerStep || item.symbol !== state.clue[state.powerStep])) return 'WRONG_ORDER';
  // No awaits: validation + ownership + socket + score is one atomic turn.
  clearHand(player, item);
  item.state = item.kind === 'crate' || item.kind === 'banner' || item.kind === 'lantern' ? 'DELIVERED' : 'INSTALLED';
  item.position = { ...target.position }; item.targetId = target.id;
  state.targets.set(target.id, item.id);
  state.score += target.phase === 'any' ? 50 : 100;
  if (item.kind === 'module') state.powerStep++;
  if (state.phase === 'supply' && ['decor-a', 'decor-b', 'cable-socket', 'fuse-socket'].every(id => state.targets.get(id))) state.phase = 'power';
  if (state.phase === 'power' && state.powerStep === 3) state.phase = 'launch';
  return 'OK';
}
