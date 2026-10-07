import RAPIER from '@dimforge/rapier3d-compat';
import { COLLIDERS, RECOVERY_POINTS, WORLD_BOUNDS } from './world.js';
import type { MoveInput, Vec3 } from './protocol.js';

export const SIM_HZ = 30;
export const STEP_MS = 1000 / SIM_HZ;
export const MOVEMENT = { walk: 3.5, sprint: 5.5, crate: 3, radius: .32, halfHeight: .5, skin: .015, reach: 1.6, staleMs: 250 } as const;
let initialization: Promise<void> | undefined;
export function initPhysics(): Promise<void> { return initialization ??= RAPIER.init(); }
export function distance(a: Vec3, b: Vec3): number { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
export function inBounds(p: Vec3, margin = 0): boolean {
  return Number.isFinite(p.x + p.y + p.z) && Math.abs(p.y) < .05 && p.x >= WORLD_BOUNDS.minX + margin && p.x <= WORLD_BOUNDS.maxX - margin && p.z >= WORLD_BOUNDS.minZ + margin && p.z <= WORLD_BOUNDS.maxZ - margin;
}
export function normalizedInput(input: MoveInput): MoveInput {
  const x = Number.isFinite(input.x) ? Math.max(-1, Math.min(1, input.x)) : 0;
  const z = Number.isFinite(input.z) ? Math.max(-1, Math.min(1, input.z)) : 0;
  const length = Math.max(1, Math.hypot(x, z));
  return { x: x / length, z: z / length, sprint: input.sprint === true };
}

/** One collision world per room/predictor; players deliberately do not block each other. */
export class CollisionWorld {
  private readonly physics = new RAPIER.World({ x: 0, y: 0, z: 0 });
  private readonly controller = this.physics.createCharacterController(MOVEMENT.skin);
  private readonly probe = this.physics.createCollider(RAPIER.ColliderDesc.capsule(MOVEMENT.halfHeight, MOVEMENT.radius).setTranslation(0, .835, 0).setSensor(true));
  private readonly gate: RAPIER.Collider;
  private gateOpen = false;
  private constructor() {
    let gate: RAPIER.Collider | undefined;
    for (const def of COLLIDERS) {
      const c = this.physics.createCollider(RAPIER.ColliderDesc.cuboid(def.half.x, def.half.y, def.half.z).setTranslation(def.center.x, def.center.y, def.center.z));
      if (def.role === 'gate') gate = c;
    }
    this.gate = gate!;
    this.controller.setSlideEnabled(true);
    this.physics.timestep = 1 / SIM_HZ;
    this.physics.step();
  }
  static async create(): Promise<CollisionWorld> { await initPhysics(); return new CollisionWorld(); }
  setGate(open: boolean): void {
    if (open === this.gateOpen) return;
    this.gateOpen = open;
    this.gate.setSensor(open);
    this.physics.step();
  }
  move(position: Vec3, raw: MoveInput, carryingCrate: boolean): Vec3 {
    const input = normalizedInput(raw);
    const speed = carryingCrate ? MOVEMENT.crate : input.sprint ? MOVEMENT.sprint : MOVEMENT.walk;
    this.probe.setTranslation({ x: position.x, y: .835, z: position.z });
    this.controller.computeColliderMovement(this.probe, { x: input.x * speed / SIM_HZ, y: 0, z: input.z * speed / SIM_HZ }, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
    const delta = this.controller.computedMovement();
    return { x: Math.max(-23.66, Math.min(23.66, position.x + delta.x)), y: 0, z: Math.max(-17.66, Math.min(17.66, position.z + delta.z)) };
  }
  hasLineOfSight(from: Vec3, to: Vec3): boolean {
    const length = distance(from, to);
    if (length < .001) return true;
    const ray = new RAPIER.Ray({ x: from.x, y: from.y + .9, z: from.z }, { x: (to.x - from.x) / length, y: (to.y - from.y) / length, z: (to.z - from.z) / length });
    return this.physics.castRay(ray, length, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS) === null;
  }
  isFree(position: Vec3, radius: number = MOVEMENT.radius, includeGate = false): boolean {
    if (!inBounds(position, radius + .02)) return false;
    // Even when open, never drop an item in the gate's closing volume.
    if (includeGate && Math.abs(position.x) < .18 + radius && Math.abs(position.z) < 1.5 + radius) return false;
    return this.physics.intersectionWithShape({ x: position.x, y: .8, z: position.z }, { x: 0, y: 0, z: 0, w: 1 }, new RAPIER.Capsule(.45, radius), RAPIER.QueryFilterFlags.EXCLUDE_SENSORS) === null;
  }
  recovery(position: Vec3, accepts: (point: Vec3) => boolean = () => true): Vec3 {
    const points = [...RECOVERY_POINTS].sort((a, b) => distance(a, position) - distance(b, position));
    for (const base of points) for (const radius of [0, 1, 2, 3]) for (let i = 0; i < (radius === 0 ? 1 : 8); i++) {
      const p = { x: base.x + Math.sin(i * Math.PI / 4) * radius, y: 0, z: base.z + Math.cos(i * Math.PI / 4) * radius };
      if (this.isFree(p, .42, true) && accepts(p)) return p;
    }
    // Bounded full-campus fallback for unusually occupied recovery clusters.
    for (let x = WORLD_BOUNDS.minX + 1; x < WORLD_BOUNDS.maxX; x++) for (let z = WORLD_BOUNDS.minZ + 1; z < WORLD_BOUNDS.maxZ; z++) {
      const p = { x, y: 0, z }; if (this.isFree(p, .42, true) && accepts(p)) return p;
    }
    throw new Error('No safe recovery position in campus');
  }
  dispose(): void { this.physics.free(); }
}

export interface PredictionStep { seq: number; input: MoveInput; carryingCrate: boolean }
/** Replay only locally simulated ticks newer than the last server-applied input sequence. */
export function reconcile(world: CollisionWorld, authoritative: Vec3, ackSeq: number, pending: readonly PredictionStep[]): Vec3 {
  return pending.filter(p => p.seq > ackSeq).reduce((position, step) => world.move(position, step.input, step.carryingCrate), { ...authoritative });
}
