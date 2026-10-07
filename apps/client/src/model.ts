import { distance, TARGETS, startEligibility, interactionEligibility, targetCompleted, type GameSnapshot, type Intent, type MoveInput, type Vec3 } from '@campus/shared';
type WithoutBase<T> = T extends unknown ? Omit<T, 'requestId' | 'roundId'> : never;
export type ActionIntent = WithoutBase<Intent>;
export type HoldTarget = 'gate-switch' | 'station-a' | 'station-b';
export type ContextAction = { label: string; targetId: string; position: Vec3 } & (
  { status: 'actionable'; hold: boolean; intent: ActionIntent } |
  { status: 'blocked' | 'completed'; hold: false; intent: null }
);
export const symbols = { sun: 'Mặt trời', leaf: 'Chiếc lá', wave: 'Làn sóng' };
export const symbolIcons = { sun: '☀', leaf: '❧', wave: '≈' };
export const itemNames = { crate: 'Thùng trang trí', cable: 'Cuộn dây điện', fuse: 'Cầu chì', module: 'Mô-đun', banner: 'Băng rôn', lantern: 'Đèn lồng' };
export const activePhase = (s: GameSnapshot | null) => !!s && s.phase !== 'lobby' && s.phase !== 'results';
export function deriveLobby(s: GameSnapshot, id: string) {
  const connected = s.players.filter(p => p.connected);
  const eligibility = startEligibility(s.mode, s.players);
  return { connected: connected.length, leader: s.leaderId === id, reason: eligibility.reason, canStart: s.phase === 'lobby' && s.leaderId === id && eligibility.allowed };
}
export function contextAction(s: GameSnapshot, id: string, los: (a: Vec3, b: Vec3) => boolean): ContextAction | null {
  const p = s.players.find(p => p.id === id);
  if (!activePhase(s) || !p?.connected) return null;
  const near = (v: Vec3) => distance(p.position, v) <= 1.6 && los(p.position, v);
  const held = s.items.find(i => i.id === p.heldItemId);
  const candidates: ContextAction[] = [];
  for (const t of TARGETS) {
    if (!near(t.position) || (t.phase !== 'any' && t.phase !== s.phase)) continue;
    if (t.kind === 'gate' || t.kind === 'station' || t.kind === 'clue') {
      const eligibility = interactionEligibility(s, !!held, t);
      if (eligibility.status !== 'actionable') candidates.push({ status: eligibility.status, label: eligibility.message, targetId: t.id, position: t.position, hold: false, intent: null });
      else if (t.kind === 'clue') candidates.push({ status: 'actionable', label: 'Đọc gợi ý bí mật', targetId: t.id, position: t.position, hold: false, intent: { type: 'read-clue' } });
      else candidates.push({ status: 'actionable', label: t.label, targetId: t.id, position: t.position, hold: true, intent: { type: 'hold', targetId: t.id as HoldTarget, active: true } });
    } else if (targetCompleted(s, t)) {
      candidates.push({ status: 'completed', label: `${t.label} đã hoàn thành.`, targetId: t.id, position: t.position, hold: false, intent: null });
    } else if (held && t.kind === held.kind && (t.kind !== 'module' || t.slot === s.powerStep)) {
      candidates.push({ status: 'actionable', label: `Lắp vào ${t.label.toLocaleLowerCase('vi')}`, targetId: t.id, position: t.position, hold: false, intent: { type: 'place', itemId: held.id, expectedRevision: held.revision, targetId: t.id } });
    }
  }
  if (!held) for (const i of s.items) {
    if (i.state !== 'WORLD' || !near(i.position) || (i.kind === 'module' && s.phase !== 'power')) continue;
    candidates.push({ status: 'actionable', label: `Nhặt ${i.symbol ? symbols[i.symbol] : itemNames[i.kind]}`, targetId: i.id, position: i.position, hold: false, intent: { type: 'pickup', itemId: i.id, expectedRevision: i.revision } });
  }
  return candidates.sort((a, b) => Number(b.status === 'actionable') - Number(a.status === 'actionable') || distance(p.position, a.position) - distance(p.position, b.position))[0] ?? null;
}
export function missionView(s: GameSnapshot) {
  const supply = ['decor-a', 'decor-b', 'cable-socket', 'fuse-socket'].filter(id => s.targets.find(t => t.id === id)?.itemId).length;
  const views = {
    lobby: { step: 0, title: 'Hẹn nhau ở sân trường', detail: s.mode === 'solo' ? 'Sẵn sàng cho lượt chơi một mình.' : 'Mời ít nhất một người bạn để bắt đầu.', progress: 0 },
    supply: { step: 1, title: 'Mang lễ hội đến sân trường', detail: `Chuyển 2 thùng trang trí, dây điện và cầu chì đến sân khấu. Đã xong ${supply}/4.`, progress: supply / 4 },
    power: { step: 2, title: 'Giải mã nguồn điện', detail: `${s.mode === 'solo' ? 'Đọc bảng trong lớp học; gợi ý được giữ trên màn hình. Lắp ba biểu tượng đúng thứ tự.' : 'Một bạn đọc bảng trong lớp học. Cả nhóm lắp ba biểu tượng đúng thứ tự.'} Đã xong ${s.powerStep}/3.`, progress: s.powerStep / 3 },
    launch: { step: 3, title: s.mode === 'solo' ? 'Tự tay thắp sáng' : 'Cùng nhau thắp sáng', detail: s.mode === 'solo' ? s.stationAComplete ? 'Trạm A đã xong. Giữ E ở trạm B liên tục 3 giây để thắp sáng.' : 'Giữ E ở trạm A liên tục 3 giây, sau đó đến trạm B.' : 'Hai bạn đứng ở hai trạm sân khấu, cùng giữ E liên tục trong 3 giây.', progress: s.mode === 'solo' ? (Number(s.stationAComplete) + s.launchProgressMs / 3000) / 2 : s.launchProgressMs / 3000 },
    results: { step: 3, title: s.result === 'success' ? 'Lễ hội đã sáng đèn!' : 'Hẹn một mùa lễ hội nữa', detail: s.result === 'timeout' ? 'Hết thời gian chuẩn bị. Cùng thử lại nhé.' : s.result === 'alone' ? 'Không đủ hai bạn sau thời gian chờ.' : 'Một sân trường rực rỡ, nhờ tất cả chúng mình.', progress: s.result === 'success' ? 1 : 0 },
  };
  return views[s.phase];
}
/** Destination compatibility deliberately does not infer the undiscovered clue order. */
export function destinationIds(s: GameSnapshot, id: string): string[] {
  const p = s.players.find(p => p.id === id), item = s.items.find(i => i.id === p?.heldItemId);
  if (!activePhase(s) || !p?.connected || !item) return [];
  return TARGETS.filter(t => t.kind === item.kind && (t.phase === 'any' || t.phase === s.phase) && !targetCompleted(s, t) && (t.kind !== 'module' || t.slot === s.powerStep)).map(t => t.id);
}
export class FirstUseTips {
  private seen = new Set<string>();
  reset() { this.seen.clear(); }
  next(s: GameSnapshot, id: string, context: ContextAction | null): string | null {
    const held = s.players.find(p => p.id === id)?.heldItemId;
    const key = context?.targetId === 'gate-switch' ? 'gate' : held ? 'drop' : context?.intent?.type === 'pickup' ? 'pickup' : null;
    if (!key || this.seen.has(key)) return null;
    this.seen.add(key);
    if (key === 'pickup') return 'Đến gần vật rồi nhấn E để nhặt. Mỗi lần chỉ cầm một vật; nhấn G để đặt xuống.';
    if (key === 'drop') return 'Nhấn G ở chỗ trống để đặt đồ xuống. Điểm đến phù hợp được viền vàng trên sân và bản đồ.';
    return s.mode === 'solo' ? 'Tay trống: giữ E 1 giây, cổng mở 15 giây. Thả E trước khi mở lại; G để đặt đồ xuống.' : 'Tay trống: giữ E để mở cổng cho bạn đi qua. Thả E để đóng; G để đặt đồ xuống.';
  }
}
export interface Settings { music: number; effects: number; sensitivity: number; quality: 'high' | 'low'; reducedMotion: boolean }
export function normalizeSettings(raw: unknown): Settings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const n = (key: string, fallback: number, min: number, max: number) => typeof o[key] === 'number' && Number.isFinite(o[key]) ? Math.min(max, Math.max(min, o[key])) : fallback;
  return { music: n('music', .28, 0, 1), effects: n('effects', .7, 0, 1), sensitivity: n('sensitivity', 1, .3, 2.5), quality: o.quality === 'low' ? 'low' : 'high', reducedMotion: o.reducedMotion === true };
}
export function parseInvite(search: string) { const code = new URLSearchParams(search).get('room')?.trim().toUpperCase() ?? ''; return /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/.test(code) ? code : ''; }
export function endpointFor(origin: string, override?: string) {
  try {
    const url = new URL(override || origin);
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) throw new Error();
    if (new URL(origin).protocol === 'https:' && ['http:', 'ws:'].includes(url.protocol)) throw new Error();
    url.protocol = url.protocol === 'https:' || url.protocol === 'wss:' ? 'wss:' : 'ws:';
    return url.href.replace(/\/$/, '');
  } catch { throw new Error('Cấu hình VITE_SERVER_URL không hợp lệ. Quản trị viên cần đặt địa chỉ HTTP(S)/WS(S) hợp lệ, dùng kết nối bảo mật khi trang chạy HTTPS.'); }
}
export function cameraInput(keys: Set<string>, yaw: number): MoveInput {
  const f = Number(keys.has('KeyS')) - Number(keys.has('KeyW'));
  const r = Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
  const length = Math.max(1, Math.hypot(f, r));
  return { x: (r * Math.cos(yaw) + f * Math.sin(yaw)) / length, z: (f * Math.cos(yaw) - r * Math.sin(yaw)) / length, sprint: keys.has('ShiftLeft') || keys.has('ShiftRight') };
}
export class HoldRepeater {
  private target: HoldTarget | null = null;
  private sent = -Infinity;
  update(target: HoldTarget | null, down: boolean, now: number): ActionIntent[] {
    const next = down ? target : null; const out: ActionIntent[] = [];
    if (this.target && this.target !== next) out.push({ type: 'hold', targetId: this.target, active: false });
    if (next && (next !== this.target || now - this.sent >= 120)) { out.push({ type: 'hold', targetId: next, active: true }); this.sent = now; }
    this.target = next; return out;
  }
}
/** Every asynchronous owner checks this generation, including late matchmaking responses. */
export class SessionEpoch {
  private value = 0;
  begin() { return ++this.value; }
  cancel() { ++this.value; }
  current(value: number) { return value === this.value; }
}
