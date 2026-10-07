import { CollisionWorld, inputSchema, intentSchema, joinSchema, MOVEMENT, normalizedInput, PROTOCOL_VERSION, STEP_MS, TARGETS, WORLD_VERSION, roundDuration, startEligibility, interactionEligibility } from '@campus/shared';
import type { ErrorCode, GameSnapshot, Intent, IntentResult, PlayerSnapshot, RoomMode } from '@campus/shared';
import { active } from './model.js';
import type { DomainContext, State } from './model.js';
import { consume, reach, result } from './validation.js';
import { itemIntent, recoverItems } from './items.js';
import { finish, hold, updateMissions } from './missions.js';
import * as sessions from './sessions.js';

export interface GameOptions { layout: number; clue: number; roomCode?: string; mode?: RoomMode }
/** Synchronous domain, independent from Colyseus and presentation. No client state writes. */
export class Game {
  private readonly state: State;
  private readonly ctx: DomainContext;
  constructor(readonly world: CollisionWorld, private readonly options: GameOptions) {
    if (![0, 1, 2].includes(options.layout) || ![0, 1, 2].includes(options.clue)) throw new Error('Invalid round variant');
    this.state = sessions.newState(options.layout, options.clue, options.mode ?? 'coop');
    this.ctx = { state: this.state, world }; sessions.resetRound(this.ctx, true);
  }
  get phase() { return this.state.phase; }
  get mode() { return this.state.mode; }
  clueFor(id: string) { return this.state.players.get(id)?.clueDiscovered ? [...this.state.clue] : undefined; }
  join(id: string, name: string): boolean { return joinSchema.safeParse({ name, protocol: PROTOCOL_VERSION }).success && sessions.join(this.ctx, id, name.trim()); }
  dispose(): void { this.state.launchPair = null; }
  disconnect(id: string, voluntary = false): void { sessions.disconnect(this.ctx, id, voluntary); }
  reconnect(id: string): boolean { return sessions.reconnect(this.ctx, id); }
  input(id: string, raw: unknown): boolean {
    const p = this.state.players.get(id);
    if (!p?.connected || !active(this.state) || !consume(p, this.state.now, 'input')) return false;
    const parsed = inputSchema.safeParse(raw); if (!parsed.success) return false;
    const input = parsed.data;
    if (input.roundId !== this.state.roundId || input.seq <= p.lastSeq) return false;
    p.lastSeq = input.seq; p.input = { ...input, ...normalizedInput(input) }; p.inputAt = this.state.now;
    return true;
  }
  intent(id: string, raw: unknown): IntentResult {
    const s = this.state; const p = s.players.get(id);
    if (!p?.connected) return result(s.roundId, null, 'NOT_CONNECTED');
    const parsed = intentSchema.safeParse(raw);
    if (!parsed.success) { consume(p, s.now, 'intent'); return result(s.roundId, null, 'INVALID'); }
    const intent = parsed.data;
    if (intent.roundId !== s.roundId) { consume(p, s.now, 'intent'); return result(s.roundId, intent.requestId, 'OLD_ROUND'); }
    const fingerprint = JSON.stringify(intent);
    const prior = p.requests.get(intent.requestId);
    if (prior) {
      if (prior.fingerprint === fingerprint) return structuredClone(prior.result);
      consume(p, s.now, 'intent'); return result(s.roundId, intent.requestId, 'REQUEST_CONFLICT');
    }
    if (!consume(p, s.now, 'intent') || p.requests.size >= 16384) return result(s.roundId, intent.requestId, 'RATE_LIMIT');
    const code = this.apply(id, intent);
    const response = result(s.roundId, intent.requestId, code);
    if (intent.type === 'read-clue' || intent.type === 'hold' && intent.active) {
      const target = TARGETS.find(t => t.id === (intent.type === 'read-clue' ? 'clue-board' : intent.targetId))!;
      const eligibility = interactionEligibility(s, !!p.heldItemId, target);
      if (code !== 'OK' && eligibility.code === code) response.message = eligibility.message;
    }
    if (code === 'OK' && intent.type === 'read-clue') response.clue = [...s.clue];
    p.requests.set(intent.requestId, { fingerprint, result: structuredClone(response) });
    return response;
  }
  private apply(id: string, intent: Intent): ErrorCode {
    const s = this.state; const p = s.players.get(id)!;
    switch (intent.type) {
      case 'ready': if (s.phase !== 'lobby') return 'WRONG_PHASE'; p.ready = intent.ready; return 'OK';
      case 'start':
        if (s.leaderId !== id) return 'NOT_LEADER';
        if (s.phase !== 'lobby') return 'WRONG_PHASE';
        if (!startEligibility(s.mode, [...s.players.values()]).allowed) return 'NOT_READY';
        s.phase = 'supply'; s.deadline = s.now + roundDuration(s.mode); return 'OK';
      case 'replay':
        if (s.leaderId !== id) return 'NOT_LEADER';
        if (s.phase !== 'results') return 'WRONG_PHASE';
        sessions.resetRound(this.ctx);
        if (s.mode === 'solo') { p.ready = true; s.phase = 'supply'; s.deadline = s.now + roundDuration(s.mode); }
        return 'OK';
    }
    if (!active(s)) return 'WRONG_PHASE';
    switch (intent.type) {
      case 'pickup': case 'drop': case 'place': return itemIntent(this.ctx, p, intent);
      case 'hold': return hold(this.ctx, p, intent);
      case 'read-clue': {
        const target = TARGETS.find(t => t.id === 'clue-board')!;
        const eligibility = interactionEligibility(s, !!p.heldItemId, target);
        const code = eligibility.code === 'OK' ? reach(this.ctx, p, target.position) : eligibility.code;
        if (code === 'OK') p.clueDiscovered = true;
        return code;
      }
      case 'ping': {
        if (['sun', 'leaf', 'wave'].includes(intent.preset) && s.phase !== 'power') return 'WRONG_PHASE';
        if (!TARGETS.some(t => t.id === intent.targetId) && !s.items.has(intent.targetId) && !s.players.has(intent.targetId)) return 'WRONG_TARGET';
        if (s.now - p.pingAt < 750) return 'RATE_LIMIT';
        p.pingAt = s.now;
        s.pings.push({ id: ++s.nextPingId, playerId: id, targetId: intent.targetId, preset: intent.preset, expiresAt: s.now + 4000 });
        s.pings = s.pings.slice(-8); return 'OK';
      }
    }
  }
  /** One fixed movement step; elapsedMs is server wall time for real deadlines, never client supplied. */
  tick(elapsedMs = STEP_MS): void {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new Error('Invalid elapsed time');
    const s = this.state; s.now += elapsedMs; s.tick++;
    sessions.updateSessions(this.ctx);
    s.pings = s.pings.filter(p => p.expiresAt > s.now);
    if (!active(s)) return;
    if (s.deadline !== null && s.now >= s.deadline - 1e-6) { finish(this.ctx, 'timeout'); return; }
    for (const p of s.players.values()) {
      const input = p.connected && s.now - p.inputAt <= MOVEMENT.staleMs ? p.input : null;
      p.moving = false; p.sprinting = false;
      if (!input) continue;
      const crate = s.items.get(p.heldItemId ?? '')?.kind === 'crate';
      const previous = p.position;
      p.position = this.world.move(p.position, input, crate); p.ackSeq = input.seq;
      p.moving = Math.hypot(p.position.x - previous.x, p.position.z - previous.z) > .001;
      p.sprinting = p.moving && input.sprint && !crate;
      if (Math.hypot(input.x, input.z) > .01) p.facing = Math.atan2(input.x, input.z);
      if (p.heldItemId) s.items.get(p.heldItemId)!.position = { ...p.position };
    }
    recoverItems(this.ctx); updateMissions(this.ctx, Math.min(elapsedMs, STEP_MS));
  }
  snapshot(): GameSnapshot {
    const s = this.state;
    const players: PlayerSnapshot[] = [...s.players.values()].map(p => ({ id: p.id, name: p.name, variant: p.variant,
      connected: p.connected, ready: p.ready, position: { ...p.position }, facing: p.facing, heldItemId: p.heldItemId,
      ackSeq: p.ackSeq, moving: p.moving, sprinting: p.sprinting, holdTarget: p.holdTarget }));
    return { mode: s.mode, durationMs: roundDuration(s.mode), protocol: PROTOCOL_VERSION, worldVersion: WORLD_VERSION, roomCode: this.options.roomCode ?? '',
      tick: s.tick, serverTimeMs: s.now, roundId: s.roundId, layout: s.layout, phase: s.phase, leaderId: s.leaderId,
      remainingMs: s.deadline === null ? roundDuration(s.mode) : Math.max(0, s.deadline - (s.finishedAt ?? s.now)),
      soloRemainingMs: s.soloDeadline === null ? null : Math.max(0, s.soloDeadline - (s.finishedAt ?? s.now)),
      score: s.score, powerStep: s.powerStep, launchProgressMs: s.launchProgressMs, gateOpen: s.gateOpen, result: s.result,
      stationAComplete: s.stationAComplete, gateChargeMs: s.gateChargeMs, gateRemainingMs: Math.max(0, s.gateUntil - (s.finishedAt ?? s.now)),
      players, items: structuredClone([...s.items.values()]), targets: [...s.targets].map(([id, itemId]) => ({ id, itemId })), pings: structuredClone(s.pings) };
  }
}
