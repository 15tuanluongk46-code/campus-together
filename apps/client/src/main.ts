import './style.css';
import { CollisionWorld, STEP_MS, type GameSnapshot, type MoveInput, type PlayerSnapshot } from '@campus/shared';
import { CampusAudio } from './audio.js';
import { Input } from './input.js';
import { activePhase, contextAction, endpointFor, HoldRepeater, FirstUseTips, normalizeSettings, parseInvite, type ContextAction, type HoldTarget, type Settings } from './model.js';
import { Predictor, SnapshotBuffer } from './prediction.js';
import { CampusScene } from './scene.js';
import { Session } from './session.js';
import { UI } from './ui.js';
import { PlayActivation } from './activation.js';

// Fail before acquiring DOM event listeners, audio, physics or renderer resources.
const endpoint = endpointFor(location.origin, import.meta.env.VITE_SERVER_URL);

let stored: unknown;
try { stored = JSON.parse(localStorage.getItem('campus-settings') ?? '{}'); } catch { stored = {}; }
let settings = normalizeSettings(stored);
const abort = new AbortController();
let world: CollisionWorld | null = null;
let predictor: Predictor | null = null;
let scene: CampusScene | null = null;
let snapshot: GameSnapshot | null = null;
let localId = '';
let paused = true;
let disposed = false;
let context: ContextAction | null = null;
let hold = new HoldRepeater();
let movement: MoveInput = { x: 0, z: 0, sprint: false };
let raf = 0, accumulator = 0, lastTime = performance.now(), uiTime = 0;
let lastIntent = -Infinity, lastPing = -Infinity, lastSeenPing = -1;
const buffer = new SnapshotBuffer();
const tips = new FirstUseTips();
let nextTipAt = 0;
const audio = new CampusAudio(settings);
const root = document.querySelector<HTMLElement>('#app')!;
const ui = new UI(root, settings, parseInvite(location.search), {
  connect: (name, code, mode) => { if (!world || !scene) return; void session.connect(name, code, mode); },
  cancel: () => leave(), ready: () => { const me = snapshot?.players.find(p => p.id === localId); if (me) session.send({ type: 'ready', ready: !me.ready }); },
  start: () => session.send({ type: 'start' }), replay: () => session.send({ type: 'replay' }), leave,
  play: () => { void play(); }, pause,
  settings: applySettings,
  ping: preset => ping(preset), audio: () => { void audio.activate().then(() => audio.play('ui')).catch(() => {}); },
});
const input = new Input(ui.canvas, key => {
  if (paused || session.state !== 'online' || !activePhase(snapshot)) return;
  if (key === 'KeyE' && context?.status === 'actionable' && !context.hold && performance.now() - lastIntent > 250) {
    lastIntent = performance.now(); session.send(context.intent);
  } else if (key === 'KeyG') {
    const item = snapshot?.items.find(i => i.id === snapshot?.players.find(p => p.id === localId)?.heldItemId);
    if (item && performance.now() - lastIntent > 250) { lastIntent = performance.now(); session.send({ type: 'drop', itemId: item.id, expectedRevision: item.revision }); }
  } else if (key === 'KeyQ') ping('here');
  else if (snapshot?.phase === 'power' && ['Digit1', 'Digit2', 'Digit3'].includes(key)) { const symbol = ui.getClue()[Number(key.slice(-1)) - 1]; if (symbol) ping(symbol); }
}, pause, () => {
  if (!input.keys.has('KeyE')) for (const action of hold.update(null, false, performance.now())) session.send(action);
  const stopped = input.movement();
   if (!paused && stopped.x === 0 && stopped.z === 0) sendInput(stopped);
});
input.sensitivity = settings.sensitivity;
const activation = new PlayActivation({
  valid: () => !disposed && activePhase(snapshot) && session.state === 'online',
  lock: () => input.lock(), audio: () => audio.activate(),
  playing: () => { paused = false; accumulator = 0; lastTime = performance.now(); ui.setPaused(false); },
  failed: () => { paused = true; input.unlock(); ui.setPaused(true); ui.toast('Trình duyệt chưa bật điều khiển chuột. Bấm Tiếp tục lần nữa hoặc cho phép khóa con trỏ.', true); },
  busy: () => ui.toast('Đang chờ trình duyệt kết thúc yêu cầu chuột trước. Chờ phản hồi rồi bấm Tiếp tục; nếu vẫn chờ, tải lại trang sẽ kết thúc phiên hiện tại.'),
  silent: () => ui.toast('Chưa bật được âm thanh. Bạn vẫn chơi bình thường; bấm Tiếp tục trong menu để thử lại âm thanh.', true),
});
const session = new Session(endpoint, {
  state: (state, message) => {
    if (state !== 'online') { activation.cancel(); paused = true; input.unlock(); accumulator = 0; hold = new HoldRepeater(); }
    ui.connection(state, message);
    if (state === 'online' && activePhase(snapshot) && paused) ui.setPaused(true);
    if (state === 'ended') { scene?.resetSession(); buffer.clear(); predictor = world ? new Predictor(world) : null; }
  },
  welcome: w => { localId = w.playerId; },
  snapshot: (next, reconnect) => {
    const previous = snapshot;
    if (previous?.roundId !== next.roundId) { tips.reset(); nextTipAt = 0; }
    if (previous?.roundId !== next.roundId || reconnect) { activation.cancel(); accumulator = 0; hold = new HoldRepeater(); buffer.clear(); input.clear(); context = null; }
    snapshot = next;
    predictor?.accept(next, localId, reconnect); buffer.push(next, performance.now());
    if (previous?.phase !== next.phase) {
      const enteringPlay = !previous || !activePhase(previous) || !activePhase(next);
      if (enteringPlay) {
       activation.cancel(); input.unlock(); paused = true;
      }
      audio.play(next.result === 'success' ? 'win' : 'phase');
      if (next.phase === 'lobby') { scene?.resetSession(); document.body.classList.remove('in-game'); }
      else document.body.classList.add('in-game');
    }
    // Full first/reconnect snapshots contain recent history, not new sound events.
    const pingBaseline = !previous || previous.roundId !== next.roundId || reconnect;
    if (pingBaseline) lastSeenPing = Math.max(-1, ...next.pings.map(p => p.id));
    else {
      for (const p of next.pings) if (p.id > lastSeenPing && p.playerId !== localId) audio.play('ping');
      lastSeenPing = Math.max(lastSeenPing, ...next.pings.map(p => p.id));
    }
    ui.update(next, localId);
    if (previous?.phase !== next.phase && previous && activePhase(next)) {
      if (!activePhase(previous)) ui.setPaused(true, true);
      else ui.toast(next.phase === 'power' ? 'Đủ dụng cụ rồi! Đến lớp học đọc gợi ý nguồn điện nhé.' : next.mode === 'solo' ? 'Nguồn điện đã sẵn sàng. Giữ trạm A rồi đến trạm B nhé!' : 'Nguồn điện đã sẵn sàng. Hai bạn cùng giữ E ở hai trạm sân khấu nhé!');
    }
  },
  result: (result, action) => {
    if (!result.ok) { ui.toast(result.message, true); audio.play('error'); return; }
    if (result.clue) ui.showClue(result.clue);
    if (action?.type === 'pickup') { audio.play('pickup'); ui.toast('Đã cầm chắc. Mang đến điểm lắp đặt nhé.'); }
    if (action?.type === 'place') { audio.play('place'); ui.toast('Đã hoàn thành một phần việc của cả nhóm!'); }
    if (action?.type === 'drop') audio.play('drop');
  },
  latency: ms => ui.setLatency(ms),
  clue: data => ui.showClue(data.clue, true),
});
function sendInput(value: MoveInput) {
  if (!activePhase(snapshot) || !predictor || session.state !== 'online') return;
  const me = snapshot!.players.find(p => p.id === localId); const held = snapshot!.items.find(i => i.id === me?.heldItemId);
  const frame = predictor.step(value, held?.kind === 'crate'); if (frame) session.input(frame);
}
function pause() {
  if (!activePhase(snapshot)) return;
  activation.cancel();
  if (!paused) sendInput({ x: 0, z: 0, sprint: false });
  paused = true; input.unlock(); accumulator = 0;
  for (const action of hold.update(null, false, performance.now())) session.send(action);
  ui.setPaused(true);
}
async function play() {
  if (!paused) return;
  await activation.start();
}
function leave() {
  activation.cancel();
  tips.reset(); nextTipAt = 0;
  input.unlock(); session.leave(); snapshot = null; localId = ''; paused = true; accumulator = 0; context = null; hold = new HoldRepeater(); lastSeenPing = -1;
  buffer.clear(); scene?.resetSession(); predictor = world ? new Predictor(world) : null; ui.reset(); document.body.classList.remove('in-game');
}
function ping(preset: 'here' | 'help' | 'ready' | 'sun' | 'leaf' | 'wave') {
  if (paused || !activePhase(snapshot) || session.state !== 'online' || performance.now() - lastPing < 800) return;
  if (['sun', 'leaf', 'wave'].includes(preset) && snapshot?.phase !== 'power') return;
  const targetId = ['sun', 'leaf', 'wave'].includes(preset) ? 'clue-board' : context?.targetId ?? localId;
  if (session.send({ type: 'ping', targetId, preset })) { audio.play('ping'); lastPing = performance.now(); }
}
function applySettings(next: Settings) {
  settings = normalizeSettings(next); try { localStorage.setItem('campus-settings', JSON.stringify(settings)); } catch {}
  audio.set(settings); scene?.applySettings(settings); input.sensitivity = settings.sensitivity;
}
function frame(now: number) {
  if (disposed) return;
  const dt = Math.min((now - lastTime) / 1000, .06); lastTime = now;
  if (snapshot && world && predictor) {
    movement = paused ? { x: 0, z: 0, sprint: false } : input.movement();
    if (!paused && activePhase(snapshot) && session.state === 'online') {
      accumulator = Math.min(accumulator + dt * 1000, STEP_MS * 3);
      while (accumulator >= STEP_MS) { sendInput(movement); accumulator -= STEP_MS; }
       context = contextAction(snapshot, localId, (a, b) => world!.hasLineOfSight(a, b));
       if (now >= nextTipAt) { const tip = tips.next(snapshot, localId, context); if (tip) { ui.showTip(tip); nextTipAt = now + 6500; } }
      for (const intent of hold.update(context?.hold ? context.targetId as HoldTarget : null, !paused && input.keys.has('KeyE'), now)) session.send(intent);
    } else { context = null; accumulator = 0; }
  }
  const players = buffer.players(now);
  const me = players.find(p => p.id === localId);
  if (me && predictor && session.state === 'online') {
    me.position = { ...predictor.position }; if (Math.hypot(movement.x, movement.z) > .01 && !paused) me.facing = Math.atan2(movement.x, movement.z);
  }
  const local = predictor?.position ?? { x: -8, y: 0, z: 0 };
  const mode = !snapshot ? 'title' : snapshot.phase === 'lobby' ? 'lobby' : snapshot.phase === 'results' ? 'results' : 'play';
  const labels = scene?.render(snapshot, players as PlayerSnapshot[], localId, local, input.yaw, input.pitch, mode, paused ? null : context, dt, now / 1000) ?? [];
  if (now - uiTime > 60) { ui.showLabels(labels); ui.showContext(context, input.keys.has('KeyE')); uiTime = now; }
  const actor = scene?.actors.get(localId); if (!paused && actor) audio.footstep(actor.speed, dt);
  raf = requestAnimationFrame(frame);
}
async function boot() {
  try {
    scene = new CampusScene(ui.canvas, settings);
    await Promise.all([scene.load(v => ui.loading(v), abort.signal), CollisionWorld.create().then(w => { if (disposed || abort.signal.aborted) w.dispose(); else { world = w; predictor = new Predictor(w); } })]);
    if (disposed) return; ui.loaded(); lastTime = performance.now(); raf = requestAnimationFrame(frame);
  } catch (error) { if (disposed) return; abort.abort(); scene?.dispose(); scene = null; world?.dispose(); world = null; predictor = null; ui.loadingError(error instanceof Error ? error.message : 'Không khởi tạo được hình ảnh 3D.'); }
}
function dispose() {
  if (disposed) return; disposed = true; activation.cancel(); cancelAnimationFrame(raf); abort.abort(); input.dispose(); session.leave(); ui.dispose(); scene?.dispose(); world?.dispose(); audio.dispose();
}
ui.canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); pause(); ui.loadingError('Bộ xử lý đồ họa đã tạm ngắt.'); }, { signal: abort.signal });
window.addEventListener('pagehide', dispose, { once: true });
document.addEventListener('visibilitychange', () => { if (document.hidden) audio.suspend(); else if (!paused) void audio.activate().catch(() => {}); }, { signal: abort.signal });
if (import.meta.hot) import.meta.hot.dispose(dispose);
void boot();
