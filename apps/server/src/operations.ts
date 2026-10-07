import { AsyncLocalStorage } from 'node:async_hooks';
import { isIP } from 'node:net';
import { ServerError } from '@colyseus/core';

export interface Limits {
  maxRooms: number; createBurst: number; createRefillMs: number; maxIps: number; ipIdleMs: number;
}
const defaults: Limits = { maxRooms: 32, createBurst: 6, createRefillMs: 10000, maxIps: 4096, ipIdleMs: 600000 };
export function readLimits(env: NodeJS.ProcessEnv): Limits {
  const keys = { maxRooms: 'CAMPUS_MAX_ROOMS', createBurst: 'CAMPUS_CREATE_BURST', createRefillMs: 'CAMPUS_CREATE_REFILL_MS', maxIps: 'CAMPUS_MAX_IPS', ipIdleMs: 'CAMPUS_IP_IDLE_MS' } as const;
  const limits = { ...defaults };
  for (const key of Object.keys(keys) as (keyof Limits)[]) {
    const raw = env[keys[key]];
    if (raw !== undefined) {
      const value = Number(raw);
      if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 1) throw new Error(`${keys[key]} phải là số nguyên dương an toàn.`);
      limits[key] = value;
    }
  }
  return limits;
}
export function validateLimits(limits: Limits): Limits {
  if (!limits || typeof limits !== 'object' || Reflect.ownKeys(limits).length !== 5 ||
      Object.keys(defaults).some(key => !Object.hasOwn(limits, key))) throw new Error('Admission requires exactly five known limits');
  const validated = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof Limits)[]) {
    const value = limits[key];
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid admission limit: ${key}`);
    validated[key] = value;
  }
  return Object.freeze(validated);
}
export function canonicalPeer(peer: string): string {
  // Zones identify local interfaces, not new clients. Ignore a valid zone only
  // on IPv6; reject malformed suffixes before URL canonicalization.
  const parts = peer.split('%');
  const address = parts[0]!;
  if (parts.length > 2 || (parts.length === 2 && (!/^[a-zA-Z0-9_.-]+$/.test(parts[1]!) || isIP(address) !== 6)) || !isIP(address)) {
    throw new ServerError(503, 'Không xác định được kết nối. Hãy thử lại.');
  }
  // URL serializes IPv6 to a canonical compressed lowercase address.
  if (isIP(address) === 4) return address;
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([\da-f]+):([\da-f]+)$/.exec(canonical);
  if (!mapped) return canonical;
  const high = parseInt(mapped[1]!, 16), low = parseInt(mapped[2]!, 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}
interface RoomHealth { created: number; lastSuccess: number | null; failed: boolean }
export interface RoomReservation { initialized(): void; heartbeat(): void; fail(): void; release(): void }
interface AllocationGrant { active: boolean; consumed: boolean; abandon?: () => Promise<unknown> }

/** Single-process owner. No timers or player/room identifiers in readiness. */
export class ServerOperations {
  private readonly request = new AsyncLocalStorage<AllocationGrant>();
  private readonly buckets = new Map<string, { tokens: number; updated: number; seen: number }>();
  private readonly rooms = new Set<RoomHealth>();
  private readonly initializing = new Set<Promise<void>>();
  private status: 'starting' | 'ready' | 'draining' = 'starting';
  readonly limits: Limits;
  constructor(limits: Limits = readLimits({}), private readonly now = () => performance.now()) { this.limits = validateLimits(limits); }
  get identityCount() { return this.buckets.size; }
  started(): void { if (this.status !== 'draining') this.status = 'ready'; }
  drain(): void { this.status = 'draining'; }
  async waitForInitialization(): Promise<void> { await Promise.all(this.initializing); }
  assertAccepting(): void {
    if (this.status === 'draining') throw new ServerError(503, 'Máy chủ đang dừng. Hãy thử lại sau.');
  }
  /** Charges every allocating HTTP request, even if its JSON/options are invalid. */
  admit(peer: string): void {
    this.assertAccepting();
    const ip = canonicalPeer(peer), now = this.now();
    for (const [key, bucket] of this.buckets) if (now - bucket.seen >= this.limits.ipIdleMs) this.buckets.delete(key);
    let bucket = this.buckets.get(ip);
    if (!bucket) {
      if (this.buckets.size >= this.limits.maxIps) throw new ServerError(503, 'Máy chủ đang bận. Hãy thử lại sau.');
      bucket = { tokens: this.limits.createBurst, updated: now, seen: now }; this.buckets.set(ip, bucket);
    }
    bucket.tokens = Math.min(this.limits.createBurst, bucket.tokens + (now - bucket.updated) / this.limits.createRefillMs);
    bucket.updated = now; bucket.seen = now;
    if (bucket.tokens < 1) throw new ServerError(429, 'Bạn tạo phòng quá nhanh. Hãy thử lại sau.');
    bucket.tokens--;
  }
  /** A grant belongs to one awaited HTTP dispatch, not its retained async children. */
  async allocation<T>(peer: string, dispatch: () => Promise<T>): Promise<T> {
    this.admit(peer);
    const grant: AllocationGrant = { active: true, consumed: false };
    return this.request.run(grant, async () => {
      try { return await dispatch(); }
      finally {
        grant.active = false;
        // Pinned framework can throw after onCreate without disposing the room.
        // Registration/release removes this cleanup; never free a live room here.
        await grant.abandon?.();
      }
    });
  }
  /** Must run in a trusted request context; reserve before the first initialization await. */
  reserve(abandon?: () => Promise<unknown>): RoomReservation {
    const grant = this.request.getStore();
    if (!grant?.active || grant.consumed) throw new ServerError(503, 'Quyền tạo phòng đã hết hạn. Hãy thử lại.');
    grant.consumed = true;
    if (this.status === 'draining' || this.rooms.size >= this.limits.maxRooms) {
      throw new ServerError(503, 'Máy chủ đang bận hoặc đang dừng. Hãy thử lại sau.');
    }
    const health: RoomHealth = { created: this.now(), lastSuccess: null, failed: false };
    this.rooms.add(health);
    let resolve!: () => void;
    const pending = new Promise<void>(done => { resolve = done; }); this.initializing.add(pending);
    if (abandon) grant.abandon = abandon;
    const initialized = () => { delete grant.abandon; this.initializing.delete(pending); resolve(); };
    return {
      initialized,
      heartbeat: () => { if (this.rooms.has(health) && !health.failed) health.lastSuccess = this.now(); },
      fail: () => { if (this.rooms.has(health)) health.failed = true; },
      release: () => { this.rooms.delete(health); initialized(); },
    };
  }
  readiness() {
    const now = this.now(); let stale = 0, failed = 0, starting = 0, oldestSuccessAgeMs: number | null = null;
    for (const room of this.rooms) {
      if (room.failed) failed++;
      if (room.lastSuccess === null) { if (now - room.created < 5000) starting++; else stale++; }
      else {
        const age = Math.max(0, now - room.lastSuccess);
        oldestSuccessAgeMs = Math.max(oldestSuccessAgeMs ?? 0, age);
        if (age > 2000) stale++;
      }
    }
    const status = this.status !== 'ready' ? this.status : stale || failed ? 'degraded' : 'ready';
    return { status, rooms: this.rooms.size, capacity: this.limits.maxRooms, simulation: { starting, stale, failed, oldestSuccessAgeMs } };
  }
}
