import { z } from 'zod';

export const PROTOCOL_VERSION = 1 as const;
export interface Vec3 { x: number; y: number; z: number }
export type Phase = 'lobby' | 'supply' | 'power' | 'launch' | 'results';
export type RoomMode = 'solo' | 'coop';
export type SymbolId = 'sun' | 'leaf' | 'wave';
export type ItemKind = 'crate' | 'cable' | 'fuse' | 'module' | 'banner' | 'lantern';
export type ItemState = 'WORLD' | 'CARRIED' | 'INSTALLED' | 'DELIVERED';
export interface MoveInput { x: number; z: number; sprint: boolean }
export interface InputFrame extends MoveInput { seq: number; roundId: number }
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const request = { requestId: id, roundId: z.number().int().nonnegative().safe() };
const revision = z.number().int().nonnegative().safe();
export const inputSchema = z.strictObject({
  seq: revision, roundId: revision, x: z.number().finite().min(-1).max(1),
  z: z.number().finite().min(-1).max(1), sprint: z.boolean(),
});
export const intentSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...request, type: z.literal('ready'), ready: z.boolean() }),
  z.strictObject({ ...request, type: z.literal('start') }),
  z.strictObject({ ...request, type: z.literal('replay') }),
  z.strictObject({ ...request, type: z.literal('pickup'), itemId: id, expectedRevision: revision }),
  z.strictObject({ ...request, type: z.literal('drop'), itemId: id, expectedRevision: revision }),
  z.strictObject({ ...request, type: z.literal('place'), itemId: id, expectedRevision: revision, targetId: id }),
  z.strictObject({ ...request, type: z.literal('hold'), targetId: z.enum(['gate-switch', 'station-a', 'station-b']), active: z.boolean() }),
  z.strictObject({ ...request, type: z.literal('read-clue') }),
  z.strictObject({ ...request, type: z.literal('ping'), targetId: id, preset: z.enum(['here', 'help', 'ready', 'sun', 'leaf', 'wave']) }),
]);
export type Intent = z.infer<typeof intentSchema>;
export const joinSchema = z.strictObject({ name: z.string().trim().min(1).max(24).regex(/^[^\p{Cc}\p{Cf}<>]*$/u), protocol: z.literal(PROTOCOL_VERSION) });
export const createSchema = joinSchema.extend({ mode: z.enum(['solo', 'coop']).default('coop') });
export type JoinOptions = z.infer<typeof joinSchema>;
export type ErrorCode = 'OK' | 'INVALID' | 'NOT_CONNECTED' | 'RATE_LIMIT' | 'REQUEST_CONFLICT' | 'OLD_ROUND' | 'WRONG_PHASE' | 'NOT_LEADER' | 'NOT_READY' | 'FULL' | 'UNKNOWN_ITEM' | 'STALE_REVISION' | 'NOT_WORLD' | 'HANDS_FULL' | 'NOT_HOLDER' | 'OUT_OF_REACH' | 'BLOCKED' | 'WRONG_TARGET' | 'WRONG_ORDER' | 'OCCUPIED' | 'UNSAFE_DROP';
export interface IntentResult { requestId: string | null; roundId: number; ok: boolean; code: ErrorCode; message: string; clue?: SymbolId[] }
export interface PlayerSnapshot {
  id: string; name: string; variant: number; connected: boolean; ready: boolean;
  position: Vec3; facing: number; heldItemId: string | null; ackSeq: number;
  moving: boolean; sprinting: boolean; holdTarget: string | null;
}
export interface ItemSnapshot {
  id: string; kind: ItemKind; symbol: SymbolId | null; state: ItemState;
  position: Vec3; holderId: string | null; targetId: string | null; revision: number;
}
export interface TargetSnapshot { id: string; itemId: string | null }
export interface PingSnapshot { id: number; playerId: string; targetId: string; preset: Extract<Intent, { type: 'ping' }>['preset']; expiresAt: number }
export interface GameSnapshot {
  mode: RoomMode; durationMs: number;
  protocol: typeof PROTOCOL_VERSION; worldVersion: string; roomCode: string;
  tick: number; serverTimeMs: number; roundId: number; layout: number; phase: Phase;
  leaderId: string | null; remainingMs: number; soloRemainingMs: number | null;
  score: number; powerStep: number; launchProgressMs: number; gateOpen: boolean;
  stationAComplete: boolean; gateChargeMs: number; gateRemainingMs: number;
  result: 'success' | 'timeout' | 'alone' | null;
  players: PlayerSnapshot[]; items: ItemSnapshot[]; targets: TargetSnapshot[]; pings: PingSnapshot[];
}
export interface Welcome { protocol: typeof PROTOCOL_VERSION; playerId: string; roomCode: string; tickRate: 30; snapshotRate: 15 }
export interface SessionEnd { code: 'SERVER_SHUTDOWN'; message: string }
export interface ClientMessages { input: InputFrame; intent: Intent; sync: { protocol: typeof PROTOCOL_VERSION } }
export interface PrivateClue { roundId: number; clue: SymbolId[] }
export interface ServerMessages { welcome: Welcome; snapshot: GameSnapshot; result: IntentResult; sessionEnd: SessionEnd; clue: PrivateClue }
export const ROUND_MS = 12 * 60_000;
