import type { CollisionWorld, GameSnapshot, InputFrame, IntentResult, ItemSnapshot, PlayerSnapshot, RoomMode, SymbolId } from '@campus/shared';

export { ROUND_MS } from '@campus/shared';
export const DISCONNECT_DROP_MS = 3_000;
export const RECONNECT_MS = 30_000;
export const ALONE_GRACE_MS = 60_000;
export const HOLD_EXPIRY_MS = 400;
export interface Player extends PlayerSnapshot {
  input: InputFrame | null; inputAt: number; lastSeq: number;
  disconnectedAt: number | null; holdAt: number;
  requests: Map<string, { fingerprint: string; result: IntentResult }>;
  intentTokens: number; inputTokens: number; tokensAt: number;
  pingAt: number;
  clueDiscovered: boolean; gateNeedsRelease: boolean;
}
export interface State {
  readonly mode: RoomMode;
  now: number; tick: number; roundId: number; layout: number; clueIndex: number;
  phase: GameSnapshot['phase']; leaderId: string | null;
  deadline: number | null; soloDeadline: number | null; finishedAt: number | null;
  score: number; powerStep: number; launchProgressMs: number;
  launchPair: { a: string; b: string } | null;
  gateOpen: boolean; result: GameSnapshot['result'];
  gateChargeMs: number; gateUntil: number; stationAComplete: boolean;
  players: Map<string, Player>; items: Map<string, ItemSnapshot>;
  targets: Map<string, string | null>; clue: readonly SymbolId[];
  pings: GameSnapshot['pings']; nextPingId: number;
}
export interface DomainContext { state: State; world: CollisionWorld }
export function active(state: State): boolean { return state.phase !== 'lobby' && state.phase !== 'results'; }
