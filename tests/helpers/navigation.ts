import { CollisionWorld, distance } from '../../packages/shared/src/movement.js';
import type { Vec3 } from '../../packages/shared/src/protocol.js';

/** Test-only grid route planner. Clients still send actual inputs at normal speed. */
export function route(world: CollisionWorld, from: Vec3, to: Vec3): Vec3[] {
  const key = (x: number, z: number) => `${x},${z}`;
  const start = { x: Math.round(from.x), y: 0, z: Math.round(from.z) };
  const goal = { x: Math.round(to.x), y: 0, z: Math.round(to.z) };
  const queue = [start];
  const parents = new Map<string, Vec3 | null>([[key(start.x, start.z), null]]);
  let found: Vec3 | undefined;
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i]!;
    if (distance(p, goal) < .1) { found = p; break; }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const n = { x: p.x + dx, y: 0, z: p.z + dz };
      if (parents.has(key(n.x, n.z)) || !world.isFree(n, .4) || !world.hasLineOfSight(p, n)) continue;
      parents.set(key(n.x, n.z), p); queue.push(n);
    }
  }
  if (!found) throw new Error(`No route ${JSON.stringify(from)} -> ${JSON.stringify(to)}`);
  const path: Vec3[] = [to];
  for (let p: Vec3 | null = found; p; p = parents.get(key(p.x, p.z)) ?? null) path.unshift(p);
  // Keep corners only, reducing network bot overshoot at redundant nodes.
  return path.filter((p, i) => i === 0 || i === path.length - 1 || (p.x - path[i - 1]!.x) * (path[i + 1]!.z - p.z) !== (p.z - path[i - 1]!.z) * (path[i + 1]!.x - p.x));
}
