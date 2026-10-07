import { Client, type Room } from '@colyseus/sdk';
import { PROTOCOL_VERSION, WORLD_VERSION, type GameSnapshot, type InputFrame, type Intent, type IntentResult, type Welcome, type RoomMode, type PrivateClue } from '@campus/shared';
import { SessionEpoch, type ActionIntent } from './model.js';
export type NetworkState = 'idle' | 'connecting' | 'online' | 'reconnecting' | 'ended';
export interface SessionEvents {
  state(state: NetworkState, message: string): void;
  snapshot(s: GameSnapshot, reconnect: boolean): void;
  welcome(w: Welcome): void;
  result(r: IntentResult, action: ActionIntent | undefined): void;
  latency(ms: number): void;
  clue?(clue: PrivateClue): void;
}
/** Owns the socket; cancelled/late attempts must close themselves, never adopt UI state. */
export class Session {
  private client: Client;
  private room: Room | null = null;
  private epoch = new SessionEpoch();
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private pending = new Map<string, { action: ActionIntent; at: number }>();
  private latest: GameSnapshot | null = null;
  private reconnect = false;
  private interrupted = false;
  private lastSnapshot = 0;
  state: NetworkState = 'idle';
  constructor(endpoint: string, private events: SessionEvents) { this.client = new Client(endpoint); }
  async connect(name: string, code?: string, mode: RoomMode = 'coop') {
    if (this.state === 'connecting' || this.state === 'online' || this.state === 'reconnecting') return;
    this.leave(); const epoch = this.epoch.begin(); this.setState('connecting', code ? 'Đang tìm phòng của bạn…' : 'Đang mở cổng sân trường…');
    this.deadline = setTimeout(() => { if (this.epoch.current(epoch)) this.end('Kết nối quá lâu. Kiểm tra mạng rồi thử lại.'); }, 12000);
    try {
      const room = code ? await this.client.joinById(code, { name, protocol: PROTOCOL_VERSION }) : await this.client.create('campus', { name, protocol: PROTOCOL_VERSION, mode });
      let startSolo = !code && mode === 'solo';
      if (!this.epoch.current(epoch)) { room.reconnection.enabled = false; room.onMessage('*', () => {}); void room.leave().catch(() => {}); return; }
      this.room = room; room.reconnection.maxRetries = 20; room.reconnection.minDelay = 500; room.reconnection.maxDelay = 2000; room.reconnection.minUptime = 0; room.reconnection.maxEnqueuedMessages = 0;
      const current = () => this.epoch.current(epoch) && this.room === room;
      room.onMessage<Welcome>('welcome', w => { if (current()) this.events.welcome(w); });
      room.onMessage<GameSnapshot>('snapshot', s => {
        if (!current()) return;
        if (s.protocol !== PROTOCOL_VERSION || s.worldVersion !== WORLD_VERSION) { this.end('Phiên bản sân trường đã đổi. Tải lại trang để cập nhật.'); return; }
        if (this.latest && (s.roundId < this.latest.roundId || s.tick < this.latest.tick)) return;
        if (this.latest && this.latest.roundId !== s.roundId) this.pending.clear();
        this.lastSnapshot = performance.now(); this.latest = s; clearTimeout(this.deadline);
        if (this.state !== 'online') this.setState('online', this.interrupted
          ? 'Đã nối lại. Có thao tác trước khi mất mạng chưa được xác nhận; hãy kiểm tra trạng thái hiện tại rồi thao tác lại nếu cần.'
          : 'Đã kết nối');
        this.interrupted = false;
        this.events.snapshot(s, this.reconnect); this.reconnect = false;
        if (startSolo) {
          startSolo = false;
          if (s.mode === 'solo' && s.phase === 'lobby') { this.send({ type: 'ready', ready: true }); this.send({ type: 'start' }); }
        }
      });
      room.onMessage<PrivateClue>('clue', data => {
        if (current() && data.roundId === this.latest?.roundId) this.events.clue?.(data);
      });
      room.onMessage<IntentResult>('result', r => {
        if (!current() || (this.latest && r.roundId !== this.latest.roundId)) return;
        const record = r.requestId ? this.pending.get(r.requestId) : undefined;
        if (r.requestId && !record) return; // cancelled/expired replies cannot trigger stale action feedback
        if (r.requestId) this.pending.delete(r.requestId);
        this.events.result(r, record?.action);
      });
      room.onMessage<{ message: string }>('sessionEnd', e => { if (current()) this.end(e.message); });
      room.onDrop(() => {
        if (!current()) return;
        this.reconnect = true;
        this.interrupted ||= [...this.pending.values()].some(p => p.action.type !== 'hold');
        this.pending.clear(); this.setState('reconnecting', 'Mất kết nối. Đang giữ chỗ cho bạn…');
        clearTimeout(this.deadline); this.deadline = setTimeout(() => { if (current()) this.end('Không thể nối lại trong 28 giây. Chỗ dành đã hết hạn; hãy tạo hoặc vào phòng mới.'); }, 28000);
      });
      room.onReconnect(() => { if (current()) { this.reconnect = true; room.send('sync', { protocol: PROTOCOL_VERSION }); } });
      room.onLeave(() => { if (current()) this.end('Phiên chơi đã kết thúc. Hãy tạo phòng mới hoặc xin lại mã phòng.'); });
      room.onError((_code, message) => { if (current() && this.state === 'connecting') this.end(message || 'Không thể mở phòng. Hãy thử lại.'); });
      room.send('sync', { protocol: PROTOCOL_VERSION });
      this.heartbeat = setInterval(() => {
        if (!current()) return;
        if (this.state === 'online') {
          room.ping(ms => { if (current()) this.events.latency(ms); });
          if (performance.now() - this.lastSnapshot > 4500) {
            this.setState('reconnecting', 'Máy chủ chưa phản hồi. Đang nối lại…');
            room.connection.close(4010);
          }
        }
        for (const [id, p] of this.pending) if (performance.now() - p.at > 6000) this.pending.delete(id);
      }, 2000);
    } catch (error) {
      if (!this.epoch.current(epoch)) return;
      const message = error instanceof Error ? error.message : '';
      this.end(/full|locked|409|403|còn chỗ|bắt đầu/i.test(message) ? 'Phòng đã đủ người hoặc đang chơi. Nhờ bạn bè mời ở lượt tiếp theo.' : /not found|404|expired/i.test(message) ? 'Không tìm thấy phòng. Kiểm tra đủ 8 ký tự hoặc xin mã mới.' : 'Không kết nối được máy chủ. Kiểm tra mạng và địa chỉ máy chủ rồi thử lại.');
    }
  }
  send(action: ActionIntent): boolean {
    if (this.state !== 'online' || !this.room || !this.latest) return false;
    const requestId = crypto.randomUUID(); const intent = { ...action, requestId, roundId: this.latest.roundId } as Intent;
    this.pending.set(requestId, { action, at: performance.now() }); this.room.send('intent', intent); return true;
  }
  input(frame: InputFrame) { if (this.state === 'online') this.room?.send('input', frame); }
  leave() {
    this.epoch.cancel(); clearInterval(this.heartbeat); clearTimeout(this.deadline); this.pending.clear();
    const room = this.room; this.room = null; this.latest = null; this.reconnect = false; this.interrupted = false;
    if (room) {
      room.reconnection.enabled = false;
      // Guarded callbacks reject late state until the leave handshake completes.
      void room.leave().catch(() => {}).finally(() => room.removeAllListeners());
    }
    this.state = 'idle';
  }
  private end(message: string) { this.leave(); this.setState('ended', message); }
  private setState(state: NetworkState, message: string) { this.state = state; this.events.state(state, message); }
}
