import { TARGETS, interactionEligibility } from '@campus/shared';
import type { ErrorCode, Intent } from '@campus/shared';
import { HOLD_EXPIRY_MS, active } from './model.js';
import type { DomainContext, Player, State } from './model.js';
import { reach } from './validation.js';

export function finish(ctx: DomainContext, reason: State['result']): void {
  const s = ctx.state;
  if (!active(s)) return;
  s.phase = 'results'; s.result = reason; s.finishedAt = s.now; s.gateOpen = false; ctx.world.setGate(false);
  s.gateUntil = 0; s.gateChargeMs = 0; s.launchPair = null;
  if (reason === 'success') s.score += 500;
  for (const p of s.players.values()) { p.input = null; p.holdTarget = null; p.gateNeedsRelease = false; p.moving = false; p.sprinting = false; }
}
export function hold(ctx: DomainContext, p: Player, intent: Extract<Intent, { type: 'hold' }>): ErrorCode {
  if (!intent.active) {
    if (p.holdTarget === intent.targetId) clearHold(ctx, p);
    if (intent.targetId === 'gate-switch') p.gateNeedsRelease = false;
    return 'OK';
  }
  const target = TARGETS.find(t => t.id === intent.targetId)!;
  const eligibility = interactionEligibility(ctx.state, !!p.heldItemId, target);
  if (eligibility.code !== 'OK') return eligibility.code;
  const code = reach(ctx, p, target.position); if (code !== 'OK') return code;
  if (p.holdTarget !== target.id) clearHold(ctx, p);
  p.holdTarget = target.id; p.holdAt = ctx.state.now;
  return 'OK';
}
/** Reset partial work at interruption time, including release/repress within one tick. */
export function clearHold(ctx: DomainContext, p: Player): void {
  if (p.holdTarget === 'gate-switch') ctx.state.gateChargeMs = 0;
  const s = ctx.state;
  if ((p.holdTarget === 'station-a' || p.holdTarget === 'station-b') &&
      (s.mode === 'solo' || s.launchPair?.a === p.id || s.launchPair?.b === p.id)) {
    s.launchProgressMs = 0; s.launchPair = null;
  }
  p.holdTarget = null;
}
export function updateMissions(ctx: DomainContext, elapsed: number): void {
  const s = ctx.state;
  for (const p of s.players.values()) {
    if (!p.holdTarget) continue;
    const target = TARGETS.find(t => t.id === p.holdTarget)!;
    if (!p.connected || s.now - p.holdAt > HOLD_EXPIRY_MS || p.heldItemId || reach(ctx, p, target.position) !== 'OK' || (target.phase !== 'any' && target.phase !== s.phase)) clearHold(ctx, p);
  }
  const players = [...s.players.values()];
  let open = players.some(p => p.holdTarget === 'gate-switch');
  if (s.mode === 'solo') {
    const holder = players.find(p => p.holdTarget === 'gate-switch' && !p.gateNeedsRelease);
    s.gateChargeMs = holder ? Math.min(1000, s.gateChargeMs + elapsed) : 0;
    if (holder && s.gateChargeMs >= 1000 - 1e-6) {
      s.gateUntil = s.now + 15000; holder.gateNeedsRelease = true; s.gateChargeMs = 0;
    }
    open = s.now < s.gateUntil;
  }
  // Safety interlock: closure waits until the doorway is clear, so no player is embedded.
  if (!open && s.gateOpen) open = players.some(p => Math.abs(p.position.x) < .55 && Math.abs(p.position.z) < 1.85);
  s.gateOpen = open; ctx.world.setGate(open);
  if (s.phase !== 'launch') return;
  if (s.mode === 'solo') {
    const target = s.stationAComplete ? 'station-b' : 'station-a';
    s.launchProgressMs = players.some(p => p.holdTarget === target) ? s.launchProgressMs + elapsed : 0;
    if (s.launchProgressMs >= 3000 - 1e-6) {
      if (!s.stationAComplete) { s.stationAComplete = true; s.launchProgressMs = 0; for (const p of players) if (p.holdTarget === 'station-a') clearHold(ctx, p); }
      else { s.launchProgressMs = 3000; finish(ctx, 'success'); }
    }
    return;
  }
  if (!s.launchPair) {
    const a = players.find(p => p.holdTarget === 'station-a');
    const b = players.find(p => p.holdTarget === 'station-b');
    if (a && b && a.id !== b.id) s.launchPair = { a: a.id, b: b.id };
  }
  s.launchProgressMs = s.launchPair ? s.launchProgressMs + elapsed : 0;
  if (s.launchProgressMs >= 3000 - 1e-6) { s.launchProgressMs = 3000; finish(ctx, 'success'); }
}
