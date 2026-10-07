import { CLUE_ORDERS, ITEM_LAYOUTS, SPAWNS, TARGETS, roomCapacity, type RoomMode } from '@campus/shared';
import type { DomainContext, Player, State } from './model.js';
import { DISCONNECT_DROP_MS, RECONNECT_MS, ALONE_GRACE_MS, active } from './model.js';
import { drop } from './items.js';
import { clearHold, finish } from './missions.js';

export function resetRound(ctx: DomainContext, initial = false): void {
  const s = ctx.state;
  if (!initial) { s.roundId++; s.layout = (s.layout + 1) % 3; s.clueIndex = (s.clueIndex + 1) % 3; }
  s.clue = CLUE_ORDERS[s.clueIndex]!;
  s.items = new Map(ITEM_LAYOUTS[s.layout]!.map(i => [i.id, { ...i, position: { ...i.position }, revision: 0, state: 'WORLD', holderId: null, targetId: null }]));
  s.targets = new Map(TARGETS.filter(t => !['clue', 'gate', 'station'].includes(t.kind)).map(t => [t.id, null]));
  s.phase = 'lobby'; s.score = 0; s.powerStep = 0; s.launchProgressMs = 0; s.result = null; s.deadline = null; s.soloDeadline = null; s.finishedAt = null; s.gateOpen = false; s.pings = [];
  s.gateChargeMs = 0; s.gateUntil = 0; s.stationAComplete = false; s.launchPair = null;
  ctx.world.setGate(false);
  for (const p of s.players.values()) {
    p.position = { ...SPAWNS[p.variant]! }; p.ready = false; p.heldItemId = null;
    p.holdTarget = null; p.input = null; p.ackSeq = -1; p.lastSeq = -1;
    p.moving = false; p.sprinting = false; p.requests.clear(); p.pingAt = -Infinity;
    p.clueDiscovered = false; p.gateNeedsRelease = false;
  }
}
export function newState(layout: number, clueIndex: number, mode: RoomMode = 'coop'): State {
  return { mode, gateChargeMs: 0, gateUntil: 0, stationAComplete: false, now: 0, tick: 0, roundId: 1, layout, clueIndex, phase: 'lobby', leaderId: null,
    deadline: null, soloDeadline: null, finishedAt: null, score: 0, powerStep: 0, launchProgressMs: 0, launchPair: null,
    gateOpen: false, result: null, players: new Map(), items: new Map(), targets: new Map(),
    clue: [], pings: [], nextPingId: 0 };
}
export function join(ctx: DomainContext, id: string, name: string): boolean {
  const s = ctx.state;
  if (s.phase !== 'lobby' || s.players.has(id) || s.players.size >= roomCapacity(s.mode)) return false;
  const used = [...s.players.values()].map(p => p.variant);
  const variant = [0, 1, 2, 3].find(v => !used.includes(v))!;
  const p: Player = { id, name, variant, connected: true, ready: false, position: { ...SPAWNS[variant]! },
    facing: 0, heldItemId: null, ackSeq: -1, lastSeq: -1, moving: false, sprinting: false,
    holdTarget: null, holdAt: 0, input: null, inputAt: 0, disconnectedAt: null,
    requests: new Map(), intentTokens: 24, inputTokens: 90, tokensAt: s.now, pingAt: -Infinity, clueDiscovered: false, gateNeedsRelease: false };
  s.players.set(id, p); if (!s.leaderId) s.leaderId = id;
  return true;
}
function transfer(s: State): void {
  if (!s.leaderId || !s.players.get(s.leaderId)?.connected) s.leaderId = [...s.players.values()].find(p => p.connected)?.id ?? null;
}
export function disconnect(ctx: DomainContext, id: string, voluntary: boolean): void {
  const s = ctx.state; const p = s.players.get(id); if (!p) return;
  clearHold(ctx, p); p.gateNeedsRelease = false;
  if (voluntary) { drop(ctx, p, true); s.players.delete(id); }
  else if (p.connected) { p.connected = false; p.disconnectedAt = s.now; p.input = null; p.holdTarget = null; p.moving = false; p.sprinting = false; }
  transfer(s); updateSessions(ctx);
}
export function reconnect(ctx: DomainContext, id: string): boolean {
  const s = ctx.state; const p = s.players.get(id);
  if (!p || p.connected || p.disconnectedAt === null || s.now - p.disconnectedAt >= RECONNECT_MS) return false;
  if (s.now - p.disconnectedAt >= DISCONNECT_DROP_MS) drop(ctx, p, true);
  p.connected = true; p.disconnectedAt = null; p.input = null; p.holdTarget = null;
  transfer(s); updateSessions(ctx); return true;
}
export function updateSessions(ctx: DomainContext): void {
  const s = ctx.state;
  for (const p of s.players.values()) {
    if (p.disconnectedAt === null) continue;
    const elapsed = s.now - p.disconnectedAt;
    if (elapsed >= DISCONNECT_DROP_MS - 1e-6) drop(ctx, p, true);
    if (elapsed >= RECONNECT_MS - 1e-6) s.players.delete(p.id);
  }
  transfer(s);
  if (!active(s) || s.mode === 'solo') return;
  const connected = [...s.players.values()].filter(p => p.connected).length;
  if (connected >= 2) s.soloDeadline = null;
  else s.soloDeadline ??= s.now + ALONE_GRACE_MS;
  if (s.soloDeadline !== null && s.now >= s.soloDeadline - 1e-6) finish(ctx, 'alone');
}
