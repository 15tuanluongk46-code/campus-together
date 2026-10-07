import { randomInt } from 'node:crypto';
import { Room, ServerError } from '@colyseus/core';
import type { Client } from '@colyseus/core';
import { CollisionWorld, createSchema, joinSchema, roomCapacity, PROTOCOL_VERSION, SIM_HZ, STEP_MS } from '@campus/shared';
import { Game } from './domain.js';
import { RECONNECT_MS } from './model.js';
import type { RoomReservation, ServerOperations } from './operations.js';

const codes = new Set<string>();
function allocateCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code: string;
  do { code = Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join(''); } while (codes.has(code));
  codes.add(code); return code;
}

export class CampusRoom extends Room {
  maxClients = 4;
  maxMessagesPerSecond = 120;
  private game!: Game;
  private collision!: CollisionWorld;
  private lastTime = 0;
  private snapshotTick = 0;
  private readonly syncAt = new Map<string, number>();
  private lockChanges: Promise<void> = Promise.resolve();
  private stopping = false;
  private creatorPending = true;
  private disposed = false;
  private reservation: RoomReservation | undefined;
  constructor(private readonly operations?: ServerOperations) { super(); }

  async onCreate(options: unknown): Promise<void> {
    const parsed = createSchema.safeParse(options);
    if (!parsed.success) throw new ServerError(400, 'Tên khách, chế độ hoặc phiên bản không hợp lệ.');
    try {
      this.reservation = this.operations?.reserve(async () => { await this.disconnect(4002); });
      this.maxClients = roomCapacity(parsed.data.mode);
      this.roomId = allocateCode();
      await this.setPrivate(true);
      this.collision = await CollisionWorld.create();
      this.operations?.assertAccepting();
      this.game = new Game(this.collision, { layout: randomInt(3), clue: randomInt(3), roomCode: this.roomId, mode: parsed.data.mode });
      this.setPatchRate(null);
      this.onMessage('input', (client, input: unknown) => { if (!this.stopping) this.game.input(client.sessionId, input); });
      this.onMessage('intent', (client, intent: unknown) => {
        if (this.stopping) return;
        const previous = this.game.phase;
        const response = this.game.intent(client.sessionId, intent);
        client.send('result', response);
        if (previous !== this.game.phase) {
          const locked = this.game.phase !== 'lobby';
          // Listing writes are asynchronous; a delayed unlock must never overtake start.
          this.lockChanges = this.lockChanges.then(async () => {
            if (!this.stopping) { if (locked) await this.lock(); else await this.unlock(); }
          }).catch(error => { console.error('Campus matchmaking state update failed', error); });
          this.publish();
        }
      });
      this.onMessage('sync', (client, raw: unknown) => {
        if (this.stopping) return;
        if (!raw || typeof raw !== 'object' || Object.keys(raw).length !== 1 || !('protocol' in raw) || raw.protocol !== PROTOCOL_VERSION) return;
        const now = performance.now();
        if (now - (this.syncAt.get(client.sessionId) ?? -Infinity) < 500) return;
        this.syncAt.set(client.sessionId, now); this.sendCurrent(client);
      });
      // Unknown messages have no authority and produce no amplification.
      this.onMessage('*', () => {});
      this.lastTime = performance.now();
      this.setSimulationInterval(() => {
        if (this.stopping) return;
        try {
          const now = performance.now(); const elapsed = now - this.lastTime; this.lastTime = now;
          this.game.tick(elapsed);
          if (++this.snapshotTick % 2 === 0) this.publish();
          this.reservation?.heartbeat();
        } catch (error) {
          this.reservation?.fail(); this.stopping = true;
          this.setSimulationInterval();
          console.error('Campus simulation failed; stopping room', error);
          // Defer disconnect: the framework forbids it during onCreate. Catch
          // synchronous throws as well as rejection; never escape the timer.
          void Promise.resolve().then(() => this.disconnect(4002)).catch(error => {
            console.error('Campus failed-room disposal failed', error);
          });
        }
      }, STEP_MS);
    } catch (error) {
      this.onDispose();
      this.setSimulationInterval();
      this.clock.clear();
      throw error;
    }
  }
  /** Framework 'create' fires after registration, not merely after onCreate. */
  registered(): void { this.reservation?.initialized(); }
  onAuth(_client: Client, options: unknown): boolean {
    if (this.stopping) throw new ServerError(503, 'Phòng đã dừng. Hãy thử lại.');
    if (!(this.creatorPending ? createSchema : joinSchema).safeParse(options).success) throw new ServerError(400, 'Tên khách hoặc phiên bản không hợp lệ.');
    if (this.game.phase !== 'lobby') throw new ServerError(403, 'Lượt chơi đã bắt đầu. Hãy chờ lượt tiếp theo.');
    return true;
  }
  onJoin(client: Client, options: unknown): void {
    const parsed = (this.creatorPending ? createSchema : joinSchema).parse(options);
    if (!this.game.join(client.sessionId, parsed.name)) throw new ServerError(409, 'Phòng không còn chỗ hoặc đã bắt đầu.');
    this.creatorPending = false;
    this.sendCurrent(client); this.publish();
  }
  onDrop(client: Client): void {
    if (this.stopping) return;
    this.game.disconnect(client.sessionId);
    this.publish();
    void this.allowReconnection(client, RECONNECT_MS / 1000).catch(() => { /* onLeave finalizes expiry */ });
  }
  onReconnect(client: Client): void {
    if (this.stopping) { client.leave(4002); return; }
    if (!this.game.reconnect(client.sessionId)) { client.leave(4001, 'Chỗ dành đã hết hạn. Hãy tạo phòng mới.'); return; }
    this.syncAt.delete(client.sessionId); this.sendCurrent(client); this.publish();
  }
  onLeave(client: Client): void {
    if (this.stopping) return;
    this.game.disconnect(client.sessionId, true); this.syncAt.delete(client.sessionId); this.publish();
  }
  onBeforeShutdown(): void {
    this.stopping = true;
    this.broadcast('sessionEnd', { code: 'SERVER_SHUTDOWN', message: 'Máy chủ đã dừng. Hãy tạo phòng mới khi kết nối lại.' });
    void this.disconnect().catch(error => { console.error('Campus room shutdown failed', error); });
  }
  onDispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.stopping = true; codes.delete(this.roomId);
    try { this.game?.dispose(); this.collision?.dispose(); }
    finally { this.reservation?.release(); }
  }
  private sendCurrent(client: Client): void {
    client.send('welcome', { protocol: PROTOCOL_VERSION, playerId: client.sessionId, roomCode: this.roomId, tickRate: SIM_HZ, snapshotRate: 15 });
    const snapshot = this.game.snapshot();
    client.send('snapshot', snapshot);
    const clue = this.game.clueFor(client.sessionId);
    if (clue) client.send('clue', { roundId: snapshot.roundId, clue });
  }
  private publish(): void { this.broadcast('snapshot', this.game.snapshot()); }
}
