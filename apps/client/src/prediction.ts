import { COLLIDERS, reconcile, type CollisionWorld, type GameSnapshot, type InputFrame, type MoveInput, type PlayerSnapshot, type PredictionStep, type Vec3 } from '@campus/shared';
export class Predictor {
  position: Vec3 = { x: -8, y: 0, z: 0 };
  pending: PredictionStep[] = [];
  private seq = -1;
  private round = -1;
  constructor(private world: CollisionWorld) {}
  accept(s: GameSnapshot, id: string, reconnect: boolean) {
    const me = s.players.find(p => p.id === id); if (!me) return;
    if (s.roundId !== this.round) { this.seq = me.ackSeq; this.pending = []; this.round = s.roundId; }
    if (reconnect || s.phase === 'lobby' || s.phase === 'results') this.pending = [];
    this.seq = Math.max(this.seq, me.ackSeq);
    this.world.setGate(s.gateOpen); this.pending = this.pending.filter(p => p.seq > me.ackSeq);
    this.position = reconcile(this.world, me.position, me.ackSeq, this.pending);
  }
  step(input: MoveInput, carryingCrate: boolean): InputFrame | null {
    if (this.round < 0) return null;
    const seq = ++this.seq; this.pending.push({ seq, input, carryingCrate });
    if (this.pending.length > 60) this.pending.shift();
    this.position = this.world.move(this.position, input, carryingCrate);
    return { ...input, seq, roundId: this.round };
  }
}
export function interpolatePlayer(a: PlayerSnapshot, b: PlayerSnapshot, raw: number): PlayerSnapshot {
  const t = Math.min(1, Math.max(0, raw)); const lerp = (a: number, b: number) => a + (b - a) * t;
  const angle = Math.atan2(Math.sin(b.facing - a.facing), Math.cos(b.facing - a.facing));
  return { ...b, position: { x: lerp(a.position.x, b.position.x), y: lerp(a.position.y, b.position.y), z: lerp(a.position.z, b.position.z) }, facing: a.facing + angle * t };
}
export class SnapshotBuffer {
  private frames: { snapshot: GameSnapshot; time: number }[] = [];
  push(snapshot: GameSnapshot, now: number) {
    if (this.frames.at(-1)?.snapshot.roundId !== snapshot.roundId) this.frames = [];
    this.frames.push({ snapshot, time: now }); if (this.frames.length > 20) this.frames.shift();
  }
  players(now: number): PlayerSnapshot[] {
    const time = now - 100; const b = this.frames.find(f => f.time >= time) ?? this.frames.at(-1); if (!b) return [];
    const a = this.frames[Math.max(0, this.frames.indexOf(b) - 1)]!;
    const t = b.time === a.time ? 1 : (time - a.time) / (b.time - a.time);
    return b.snapshot.players.map(p => interpolatePlayer(a.snapshot.players.find(x => x.id === p.id) ?? p, p, t));
  }
  clear() { this.frames = []; }
}
/** Segment vs expanded shared AABBs. Expansion protects the camera near plane. */
export function cameraDistance(from: Vec3, to: Vec3, gateOpen: boolean): number {
  const delta = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
  const length = Math.hypot(delta.x, delta.y, delta.z); let closest = 1;
  for (const c of COLLIDERS) {
    if (c.role === 'gate' && gateOpen) continue;
    let lo = 0, hi = 1;
    for (const axis of ['x', 'y', 'z'] as const) {
      const min = c.center[axis] - c.half[axis] - .22, max = c.center[axis] + c.half[axis] + .22;
      if (Math.abs(delta[axis]) < .00001) { if (from[axis] < min || from[axis] > max) { hi = -1; break; } }
      else { const a = (min - from[axis]) / delta[axis], b = (max - from[axis]) / delta[axis]; lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b)); }
    }
    if (hi >= lo && lo >= 0) closest = Math.min(closest, lo);
  }
  return Math.max(.12, closest * length);
}
