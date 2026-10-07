import { COLLIDERS, TARGETS, roomCapacity, targetCompleted, type GameSnapshot, type SymbolId, type RoomMode } from '@campus/shared';
import { deriveLobby, destinationIds, itemNames, missionView, symbolIcons, symbols, type ContextAction, type Settings } from './model.js';
import type { NetworkState } from './session.js';
import type { WorldLabel } from './scene.js';
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export interface UIActions {
  connect(name: string, code?: string, mode?: RoomMode): void; cancel(): void; ready(): void; start(): void; replay(): void; leave(): void; play(): void; pause(): void;
  settings(s: Settings): void; ping(preset: 'here' | 'help' | 'ready' | SymbolId): void; audio(): void;
}
export class UI {
  readonly canvas: HTMLCanvasElement;
  private screen: HTMLElement;
  private hud: HTMLElement;
  private modal: HTMLElement;
  private labels: HTMLElement;
  private toastBox: HTMLElement;
  private network: HTMLElement;
  private announcements: HTMLElement;
  private state: 'title' | 'lobby' | 'game' | 'results' = 'title';
  private s: GameSnapshot | null = null;
  private me = '';
  private settings: Settings;
  private ready = false;
  private paused = false;
  private settingsOpen = false;
  private leaving = false;
  private submitting = false;
  private networkState: NetworkState = 'idle';
  private invite: string;
  private settingsReturn: 'pause' | 'title' = 'title';
  private networkMessage = '';
  private clue: SymbolId[] = [];
  private signature = '';
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private tipTimer: ReturnType<typeof setTimeout> | undefined;
  private abort = new AbortController();
  private labelElements = new Map<string, HTMLElement>();
  private latency = 0;
  private modalObserver: MutationObserver;
  private modalActive = false;
  private returnFocus: HTMLElement | null = null;
  private returnAction: string | undefined;
  private background: HTMLElement[] = [];
  constructor(root: HTMLElement, settings: Settings, invite: string, private actions: UIActions) {
    this.settings = settings; this.invite = invite;
    root.innerHTML = `<canvas id="campus" aria-label="Sân trường 3D" tabindex="-1"></canvas><div id="scene-labels" aria-hidden="true"></div><div class="vignette"></div><main id="screen"></main><section id="hud" hidden aria-label="Thông tin lượt chơi"></section><div id="network" role="status" aria-live="polite"></div><div id="modal"></div><div id="toasts" role="status" aria-live="polite"></div><div class="small-screen">Campus Together chơi tốt nhất bằng bàn phím và chuột trên máy tính.</div>`;
    this.canvas = root.querySelector('#campus')!; this.canvas.setAttribute('aria-label', 'Sân trường 3D');
    this.screen = root.querySelector('#screen')!; this.hud = root.querySelector('#hud')!; this.hud.setAttribute('aria-label', 'Thông tin lượt chơi');
    this.modal = root.querySelector('#modal')!; this.labels = root.querySelector('#scene-labels')!; this.toastBox = root.querySelector('#toasts')!; this.network = root.querySelector('#network')!;
    this.announcements = document.createElement('div'); this.announcements.id = 'announcements';
    this.announcements.setAttribute('role', 'status'); this.announcements.setAttribute('aria-live', 'polite');
    this.announcements.className = 'sr-only'; root.append(this.announcements);
    this.background = [...root.children].filter(e => e !== this.modal && e !== this.toastBox && e !== this.announcements) as HTMLElement[];
    this.modalObserver = new MutationObserver(() => this.syncModal());
    this.modalObserver.observe(this.modal, { childList: true });
    document.addEventListener('focusin', e => {
      if (this.modal.firstElementChild && !this.modal.contains(e.target as Node)) this.focusModal();
    }, { signal: this.abort.signal });
    root.addEventListener('click', e => this.click(e), { signal: this.abort.signal });
    root.addEventListener('submit', e => {
      if (!(e.target instanceof HTMLFormElement) || e.target.id !== 'join-form') return; e.preventDefault(); this.actions.audio();
      if (!this.ready || this.submitting) return;
      const data = new FormData(e.target); const name = String(data.get('name') ?? '').trim(); const code = String(data.get('room') ?? '').trim().toUpperCase();
      if (!name || name.length > 24 || /[\p{Cc}\p{Cf}<>]/u.test(name)) { this.toast('Đặt tên từ 1–24 ký tự, không có ký tự đặc biệt.', true); return; }
      const join = (e as SubmitEvent).submitter?.getAttribute('data-submit') === 'join';
      if (join && !/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/.test(code)) { this.toast('Mã phòng gồm 8 ký tự. Kiểm tra lại lời mời nhé.', true); return; }
      try { localStorage.setItem('campus-name', name); } catch {}
      this.submitting = true;
      this.actions.connect(name, join ? code : undefined, (e as SubmitEvent).submitter?.getAttribute('data-submit') === 'solo' ? 'solo' : 'coop');
    }, { signal: this.abort.signal });
    root.addEventListener('keydown', e => {
      if (e.key !== 'Enter' || e.isComposing || !(e.target instanceof HTMLInputElement) || !e.target.closest('#join-form')) return;
      e.preventDefault();
      if (e.repeat || !this.ready || this.submitting) return;
      const room = this.screen.querySelector<HTMLInputElement>('#room-code')!.value;
      const join = e.target.id === 'room-code' || !!room || !!this.invite;
      const button = this.screen.querySelector<HTMLButtonElement>(`[data-submit="${join ? 'join' : 'solo'}"]`);
      if (button) (e.target.form!).requestSubmit(button);
    }, { signal: this.abort.signal });
    root.addEventListener('input', e => {
      const input = e.target; if (!(input instanceof HTMLInputElement || input instanceof HTMLSelectElement) || !input.dataset.setting) return;
      const key = input.dataset.setting as keyof Settings; const raw = input instanceof HTMLInputElement && input.type === 'checkbox' ? input.checked : key === 'quality' ? input.value : Number(input.value);
      this.settings = { ...this.settings, [key]: raw }; this.actions.settings(this.settings);
      const output = input.parentElement?.querySelector('output'); if (output) output.textContent = key === 'sensitivity' ? `${Number(raw).toFixed(1)}×` : `${Math.round(Number(raw) * 100)}%`;
    }, { signal: this.abort.signal });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this.leaving) { e.preventDefault(); this.stay(); }
      else if (e.key === 'Escape' && this.settingsOpen) { e.preventDefault(); this.closeSettings(); }
      if (e.key === 'Tab' && this.modal.firstElementChild) {
        const nodes = this.modalFocusables(); if (!nodes.length) { e.preventDefault(); this.focusModal(); return; }
        const first = nodes[0]!, last = nodes.at(-1)!;
        if (!nodes.includes(document.activeElement as HTMLElement)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
        else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }, { signal: this.abort.signal });
    this.title();
  }
  private click(event: Event) {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-action]') : null; if (!target) return;
    const action = target.dataset.action!; this.actions.audio();
    if (action === 'settings') this.showSettings();
    else if (action === 'close-settings') this.closeSettings();
    else if (action === 'ready') this.actions.ready();
    else if (action === 'start') this.actions.start();
    else if (action === 'replay') this.actions.replay();
    else if (action === 'leave') this.requestLeave();
    else if (action === 'stay') this.stay();
    else if (action === 'confirm-leave') { this.leaving = false; this.actions.leave(); }
    else if (action === 'retry-entry') { this.modal.innerHTML = ''; this.networkState = 'idle'; this.toast(this.networkMessage, true); this.screen.querySelector<HTMLInputElement>('#room-code')?.focus(); }
    else if (action === 'cancel') this.actions.cancel();
    else if (action === 'play') this.actions.play();
    else if (action === 'pause') this.actions.pause();
    else if (action === 'retry-assets') location.reload();
    else if (action === 'copy') void this.copyInvite();
  }
  private requestLeave() {
    if (this.state !== 'game' || this.networkState === 'ended') { this.actions.leave(); return; }
    this.actions.pause(); this.settingsOpen = false; this.leaving = true;
    this.modal.innerHTML = `<div class="scrim game-scrim"><section class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="leave-title" aria-describedby="leave-detail"><h2 id="leave-title">Rời lượt chơi này?</h2><p id="leave-detail">Tiến độ của bạn không được lưu để trở lại. Đồng hồ vẫn chạy khi bạn quyết định.</p><button class="primary full" data-action="stay">Ở lại</button><button class="secondary full" data-action="confirm-leave">Rời lượt chơi</button></section></div>`;
    this.focusModal();
  }
  private stay() { this.leaving = false; this.paused = true; this.pauseOverlay(false); }
  private title() {
    this.submitting = false; this.leaving = false;
    this.state = 'title'; this.signature = ''; this.screen.hidden = false; this.hud.hidden = true; this.modal.innerHTML = ''; this.labels.hidden = true; this.settingsOpen = false;
    let name = ''; try { name = localStorage.getItem('campus-name') ?? ''; } catch {}
    this.screen.innerHTML = `<header class="masthead"><a class="brand" href="/" aria-label="Campus Together, trang đầu"><span class="brand-mark">ct<span>✳</span></span><span>Campus<br>Together</span></a><button class="quiet" data-action="settings" aria-label="Mở cài đặt">☷ <span>Cài đặt</span></button></header>
      <section class="title-layout"><div class="title-copy"><div class="festival-tag"><span class="sun-seal">✺</span> Một mình hoặc cùng 2–4 người bạn</div><h1>Hẹn nhau<br>ở sân trường.</h1><p>Mang một chút nắng, góp một bàn tay.<br>Cùng chuẩn bị lễ hội của chúng mình.</p><div class="title-notes"><span>18 phút một mình · 12 phút cùng bạn</span><span>Chơi bằng bàn phím & chuột</span></div></div>
      <div class="invitation"><div class="ticket-hole left"></div><div class="ticket-hole right"></div><div class="ticket-top"><span class="ticket-sun">✳</span><span>Lời mời<br><strong>mùa lễ hội</strong></span><span class="ticket-year">Sân<br>trường</span></div>
      <form id="join-form"><label for="guest-name">Bạn tên là gì?</label><input id="guest-name" name="name" autocomplete="nickname" maxlength="24" placeholder="Tên gọi thân quen" value="${escape(name)}" required>
      <button class="primary full" type="submit" data-submit="solo" ${this.ready ? '' : 'disabled'}>Chơi một mình</button>
      <button class="secondary full" type="submit" data-submit="create" ${this.ready ? '' : 'disabled'}>Tạo phòng cùng bạn <span>＋</span></button>
      <div class="or"><span>Đã có lời mời?</span></div><label for="room-code">Mã phòng</label><div class="code-row"><input id="room-code" name="room" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="8" placeholder="8 ký tự" value="${escape(this.invite)}"><button class="secondary" type="submit" data-submit="join" ${this.ready ? '' : 'disabled'}>Tham gia phòng</button></div><p class="privacy">Phòng riêng của bạn. Không cần tài khoản.</p></form>
      <div id="asset-status" class="asset-status" role="status"><span>${this.ready ? 'Sân trường đã sẵn sàng' : 'Đang chuẩn bị sân trường…'}</span><progress max="1" value="${this.ready ? 1 : 0}" aria-label="Tiến trình tải tài nguyên"></progress></div></div></section>
      <footer class="title-footer"><span>✳ &nbsp;Cùng chuẩn bị. Cùng thắp sáng.</span><span>Một trò chơi hợp tác nhỏ, một lễ hội rất riêng.</span></footer>`;
    if (this.invite) {
      this.screen.querySelector('[data-submit="join"]')!.className = 'primary';
      this.screen.querySelector('.privacy')!.textContent = 'Bạn có lời mời. Nhập tên rồi nhấn Enter để tham gia phòng này.';
      this.screen.querySelector('#room-code')!.setAttribute('aria-describedby', 'invite-note');
      this.screen.querySelector('.privacy')!.id = 'invite-note';
    }
  }
  loading(ratio: number) { const progress = this.screen.querySelector<HTMLProgressElement>('progress'); if (progress) progress.value = ratio; const label = this.screen.querySelector('#asset-status span'); if (label) label.textContent = `Chuẩn bị sân trường · ${Math.round(ratio * 100)}%`; }
  loaded() {
    this.ready = true;
    if (this.state !== 'title') return;
    this.screen.querySelectorAll<HTMLButtonElement>('[data-submit]').forEach(button => button.disabled = false);
    this.loading(1);
    const label = this.screen.querySelector('#asset-status span'); if (label) label.textContent = 'Sân trường đã sẵn sàng';
  }
  loadingError(message: string) { this.modal.innerHTML = `<div class="scrim"><section class="dialog" role="alertdialog" aria-labelledby="load-error"><span class="dialog-icon">!</span><h2 id="load-error">Sân trường chưa sẵn sàng</h2><p>${escape(message)} Kiểm tra kết nối và thử tải lại.</p><button class="primary" data-action="retry-assets">Tải lại tài nguyên</button></section></div>`; this.focusModal(); }
  connection(state: NetworkState, message: string) {
    if (state !== 'connecting') this.submitting = false;
    this.announcements.textContent = message;
    const wasReconnecting = this.networkState === 'reconnecting';
    this.networkState = state; this.networkMessage = message;
    this.network.hidden = state === 'idle' || state === 'online' || state === 'connecting';
    if (state === 'connecting') { this.modal.innerHTML = `<div class="scrim"><section class="dialog compact" role="dialog" aria-modal="true" aria-labelledby="connecting"><span class="spinner"></span><h2 id="connecting">${escape(message)}</h2><p>Chuẩn bị một chỗ cho bạn trong nhóm.</p><button class="secondary" data-action="cancel">Hủy kết nối</button></section></div>`; this.focusModal(); }
    else if (state === 'reconnecting') {
      this.network.innerHTML = `<span class="spinner small"></span><span>${escape(message)}<small>Bạn đang đứng yên; vật cầm sẽ được đặt xuống sau 3 giây.</small></span><button class="quiet" data-action="leave">Rời phiên</button>`;
      this.paused = true; this.pauseOverlay(false);
    } else if (state === 'ended') {
      // A terminal session supersedes both leave confirmation and settings.
      this.leaving = false; this.settingsOpen = false;
      this.network.hidden = true; this.modal.innerHTML = `<div class="scrim"><section class="dialog compact" role="alertdialog" aria-labelledby="ended"><span class="dialog-icon">↯</span><h2 id="ended">Phiên chơi đã khép lại</h2><p>${escape(message)}</p><button class="primary" data-action="leave">Về sân trường</button></section></div>`; this.focusModal();
      if (this.state === 'title') { const button = this.modal.querySelector<HTMLButtonElement>('button')!; button.dataset.action = 'retry-entry'; button.textContent = 'Sửa tên / mã phòng'; }
    } else if (state === 'online') {
      if (this.s?.phase === 'lobby') this.modal.innerHTML = '';
      if (wasReconnecting) this.toast(message);
    }
  }
  setLatency(ms: number) { this.latency = ms; }
  update(s: GameSnapshot, me: string) {
    const previous = this.s; this.s = s; this.me = me;
    if (s.phase === 'lobby' || s.phase === 'results') this.leaving = false;
    if (previous?.roundId !== s.roundId) { this.clue = []; this.signature = ''; }
    if (s.phase === 'lobby') this.lobby();
    else if (s.phase === 'results') this.results();
    else {
      if (this.state !== 'game') { this.state = 'game'; this.screen.hidden = true; this.hud.hidden = false; this.labels.hidden = false; this.settingsOpen = false; this.paused = true; this.setupHud(); this.pauseOverlay(true); }
      this.updateHud();
    }
  }
  private lobby() {
    if (this.state !== 'lobby' && !this.settingsOpen) this.modal.innerHTML = '';
    this.state = 'lobby'; this.hud.hidden = true; this.labels.hidden = true; this.screen.hidden = false;
    const s = this.s!, view = deriveLobby(s, this.me), local = s.players.find(p => p.id === this.me);
    const signature = JSON.stringify([s.mode, s.players.map(p => [p.id, p.ready, p.connected, p.name]), s.leaderId, this.me]);
    if (signature === this.signature) return; this.signature = signature;
    this.screen.innerHTML = `<header class="masthead"><div class="brand"><span class="brand-mark">ct<span>✳</span></span><span>Campus<br>Together</span></div><div class="header-actions"><button class="quiet" data-action="settings">☷ Cài đặt</button><button class="quiet" data-action="leave">Rời phòng</button></div></header>
      <section class="lobby-layout"><div class="lobby-heading"><span class="festival-tag">✺ &nbsp;Góc hẹn trước giờ lễ hội</span><h1>Có bạn,<br>vui hơn nhiều.</h1><p>Cả nhóm sẵn sàng rồi cùng vào sân nhé.</p><div class="room-ticket"><span>Mã phòng của nhóm</span><strong id="invite-code">${escape(s.roomCode)}</strong><button class="secondary" data-action="copy">Sao chép lời mời</button></div><div class="lobby-how"><span>01</span><p>Chuyển dụng cụ<br>đến sân khấu</p><span>02</span><p>Giải mã<br>nguồn điện</p><span>03</span><p>Cùng giữ trạm<br>và thắp sáng</p></div></div>
      <div class="lobby-sheet"><div class="sheet-heading"><h2>${s.mode === 'solo' ? 'Chơi một mình' : 'Nhóm của chúng mình'}</h2><span>${view.connected}/${roomCapacity(s.mode)} bạn</span></div><ul class="players">${Array.from({ length: roomCapacity(s.mode) }, (_, i) => { const p = s.players[i]; return p ? `<li class="player-row"><span class="avatar-badge variant-${p.variant}">${p.variant + 1}</span><span class="player-name">${escape(p.name)}${p.id === this.me ? '<small>Bạn</small>' : ''}${p.id === s.leaderId ? '<small>Trưởng nhóm</small>' : ''}</span><span class="ready-status ${p.ready && p.connected ? 'yes' : ''}">${!p.connected ? 'Đang nối lại' : p.ready ? '✓ Sẵn sàng' : 'Đang chuẩn bị'}</span></li>` : '<li class="player-row empty"><span class="empty-badge">＋</span><span>Còn chỗ cho một người bạn</span></li>'; }).join('')}</ul><p class="lobby-hint">${view.reason}</p><button class="${local?.ready ? 'secondary' : 'primary'} full" data-action="ready">${local?.ready ? '✓ Đã sẵn sàng · Bấm để đổi' : 'Mình sẵn sàng'}</button>${view.leader ? `<button class="primary full start" data-action="start" ${view.canStart ? '' : 'disabled'}>${s.mode === 'solo' ? 'Bắt đầu lượt một mình' : 'Cùng vào sân trường'}</button>` : '<p class="waiting-leader">Trưởng nhóm sẽ bắt đầu khi mọi người sẵn sàng.</p>'}<div class="mini-note">Bàn phím + chuột &nbsp; / &nbsp; ${s.durationMs / 60000} phút mỗi lượt</div></div></section>`;
    if (s.mode === 'solo') {
      this.screen.querySelector('.lobby-heading h1')!.innerHTML = 'Lễ hội<br>của riêng bạn.';
      this.screen.querySelector('.lobby-heading > p')!.textContent = 'Giữ trạm A rồi đến trạm B. Mọi phần việc đều tự tay hoàn thành.';
      this.screen.querySelector('.room-ticket')!.remove();
      this.screen.querySelector('.lobby-how')!.lastElementChild!.innerHTML = 'Giữ A rồi B<br>và thắp sáng';
    }
  }
  private setupHud() {
    this.hud.innerHTML = `<div class="hud-top"><section class="mission-card"><div class="mission-kicker"><span id="phase-number"></span><span id="clock"></span></div><h2 id="mission-title"></h2><p id="mission-detail"></p><progress id="mission-progress" max="1" value="0" aria-label="Tiến độ nhiệm vụ"></progress><div id="optional-progress"></div></section><div class="hud-right"><div class="hud-meta"><span id="network-latency"></span><button class="hud-button" data-action="pause" aria-label="Mở menu tạm nghỉ">Ⅱ <kbd>Esc</kbd></button></div><div id="team-list" class="team-list"></div><canvas id="minimap" width="220" height="170" aria-label="Bản đồ sân trường và đồng đội"></canvas><div class="map-caption"><span>Kho</span><span>Sân trường</span><span>Sân khấu</span></div></div></div>
      <div id="solo-warning" role="status" hidden></div><section id="clue-card" hidden></section><div id="context" hidden></div><div class="hud-bottom"><div class="control-strip"><span><kbd>W A S D</kbd> Di chuyển</span><span><kbd>Shift</kbd> Chạy</span><span><kbd>E</kbd> Tương tác</span><span><kbd>G</kbd> Đặt xuống</span><span><kbd>Q</kbd> Báo vị trí</span></div><div id="carried" class="carried"></div></div>`;
    const legend = document.createElement('p'); legend.className = 'map-legend';
    legend.textContent = '▲ Bạn & hướng đi · ○ Vật · □ Điểm việc · ✓ Xong · Viền vàng: nơi mang đồ';
    this.hud.querySelector('.hud-right')!.append(legend);
    const tip = document.createElement('p'); tip.id = 'first-use-tip'; tip.hidden = true; tip.setAttribute('role', 'status'); this.hud.querySelector('.mission-card')!.append(tip);
  }
  private updateHud() {
    const s = this.s!, mission = missionView(s), local = s.players.find(p => p.id === this.me);
    const text = (selector: string, value: string) => { const e = this.hud.querySelector(selector); if (e && e.textContent !== value) e.textContent = value; };
    text('#phase-number', `Việc ${mission.step} / 3`); text('#clock', `${Math.ceil(s.remainingMs / 60000) === 0 ? '00' : String(Math.floor(s.remainingMs / 60000)).padStart(2, '0')}:${String(Math.floor(s.remainingMs / 1000) % 60).padStart(2, '0')}`);
    text('#mission-title', mission.title); text('#mission-detail', mission.detail);
    (this.hud.querySelector('#mission-progress') as HTMLProgressElement).value = mission.progress;
    const optional = ['banner-socket', 'lantern-socket'].filter(id => s.targets.find(t => t.id === id)?.itemId).length;
    text('#optional-progress', `Thêm sắc màu: ${optional}/2  ·  ${s.score} điểm`);
    let gate = this.hud.querySelector<HTMLElement>('#gate-status');
    if (!gate) { gate = document.createElement('p'); gate.id = 'gate-status'; this.hud.querySelector('.mission-card')!.append(gate); }
    gate.hidden = s.mode !== 'solo';
    if (!gate.hidden) gate.textContent = s.gateRemainingMs > 0 ? `Cổng mở: ${Math.ceil(s.gateRemainingMs / 1000)} giây · Thả rồi giữ E để mở lại` : s.gateOpen ? 'Cổng chờ lối đi thông thoáng' : s.gateChargeMs > 0 ? `Đang mở cổng: ${(s.gateChargeMs / 1000).toFixed(1)} / 1 giây` : 'Cổng: giữ E 1 giây để mở trong 15 giây';
    text('#network-latency', `${Math.round(this.latency)} ms`);
    const held = s.items.find(i => i.id === local?.heldItemId);
    text('#carried', held ? `Đang cầm: ${held.symbol ? symbols[held.symbol] : itemNames[held.kind]}${held.kind === 'crate' ? ' · Đi chậm, chắc tay' : ''}` : 'Hai tay sẵn sàng');
    const team = this.hud.querySelector('#team-list')!;
    const markup = s.players.map(p => `<span class="team-pill ${p.connected ? '' : 'offline'}"><b class="variant-${p.variant}">${p.variant + 1}</b>${escape(p.name)}${p.id === this.me ? ' (bạn)' : ''}${p.holdTarget ? ' ✋' : ''}${!p.connected ? ' ↯' : ''}</span>`).join(''); if (team.innerHTML !== markup) team.innerHTML = markup;
    const solo = this.hud.querySelector<HTMLElement>('#solo-warning')!; solo.hidden = s.soloRemainingMs === null; if (s.soloRemainingMs !== null) solo.textContent = `Đợi một người bạn trở lại · ${Math.ceil(s.soloRemainingMs / 1000)} giây`;
    const clue = this.hud.querySelector<HTMLElement>('#clue-card')!;
    clue.hidden = !this.clue.length || s.phase !== 'power';
    if (!clue.hidden) { const html = `<span>${s.mode === 'solo' ? 'Gợi ý đã ghi nhớ · lắp theo thứ tự này' : 'Gợi ý riêng của bạn · nhấn phím để báo'}</span><div>${this.clue.map((symbol, i) => `<span class="symbol-badge"><kbd>${i + 1}</kbd><b>${symbolIcons[symbol]}</b>${symbols[symbol]}</span>`).join('')}</div>`; if (clue.innerHTML !== html) clue.innerHTML = html; }
    this.map(s);
  }
  private map(s: GameSnapshot) {
    const canvas = this.hud.querySelector<HTMLCanvasElement>('#minimap')!, c = canvas.getContext('2d')!;
    const x = (x: number) => (x + 25) * 4.4, z = (z: number) => (z + 19) * 4.4;
    c.clearRect(0, 0, 220, 170); c.fillStyle = '#f3e7ce'; c.fillRect(0, 0, 220, 170);
    for (const b of COLLIDERS) { if (b.role === 'gate' && s.gateOpen) continue; c.fillStyle = b.role === 'planter' ? '#438b77' : '#ac7253'; c.fillRect(x(b.center.x - b.half.x), z(b.center.z - b.half.z), Math.max(1.5, b.half.x * 8.8), Math.max(1.5, b.half.z * 8.8)); }
    const destinations = destinationIds(s, this.me);
    for (const t of TARGETS) if (t.phase === s.phase || t.phase === 'any') {
      const completed = targetCompleted(s, t);
      c.fillStyle = completed ? '#287c78' : '#805218';
      if (completed) { c.font = 'bold 10px sans-serif'; c.textAlign = 'center'; c.fillText('✓', x(t.position.x), z(t.position.z) + 3); }
      else c.fillRect(x(t.position.x) - 2, z(t.position.z) - 2, 4, 4);
      if (destinations.includes(t.id)) { c.strokeStyle = '#a16400'; c.lineWidth = 2; c.strokeRect(x(t.position.x) - 5, z(t.position.z) - 5, 10, 10); }
    }
    for (const item of s.items) if (item.state === 'WORLD' && (item.kind !== 'module' || s.phase === 'power')) { c.strokeStyle = '#a8642c'; c.beginPath(); c.arc(x(item.position.x), z(item.position.z), 2.5, 0, 6.283); c.stroke(); }
    for (const p of s.players) { c.globalAlpha = p.connected ? 1 : .35; c.fillStyle = ['#287c78', '#b95e45', '#bd871a', '#58588e'][p.variant]!; c.beginPath(); c.arc(x(p.position.x), z(p.position.z), p.id === this.me ? 5 : 4, 0, 6.283); c.fill(); c.strokeStyle = 'white'; c.lineWidth = 1.5; c.stroke(); c.fillStyle = 'white'; c.font = 'bold 7px sans-serif'; c.textAlign = 'center'; c.fillText(String(p.variant + 1), x(p.position.x), z(p.position.z) + 2.5); }
    const me = s.players.find(p => p.id === this.me);
    if (me) {
      c.save(); c.translate(x(me.position.x), z(me.position.z)); c.rotate(-me.facing);
      c.fillStyle = '#163e39'; c.beginPath(); c.moveTo(0, 12); c.lineTo(-4, 6); c.lineTo(4, 6); c.closePath(); c.fill(); c.restore();
    }
    c.globalAlpha = 1;
  }
  showContext(context: ContextAction | null, down: boolean) {
    const box = this.hud.querySelector<HTMLElement>('#context'); if (!box) return; box.hidden = !context || this.paused;
    if (context) { const actionable = context.status === 'actionable'; const html = `<kbd>${actionable ? context.hold ? 'Giữ E' : 'E' : context.status === 'completed' ? '✓' : '!'}</kbd><div><strong>${escape(context.label)}</strong><small>${!actionable ? context.status === 'completed' ? 'Phần việc này đã xong' : 'Chưa thể thực hiện' : context.hold ? down ? 'Đang giữ · Đừng thả phím' : 'Giữ liên tục; thả phím để dừng' : 'Nhấn để thực hiện'}</small></div>`; if (box.innerHTML !== html) box.innerHTML = html; box.dataset.status = context.status; box.classList.toggle('holding', context.hold && down); }
  }
  showLabels(values: WorldLabel[]) {
    const ids = new Set(values.map(v => v.id));
    for (const [id, e] of this.labelElements) if (!ids.has(id)) { e.remove(); this.labelElements.delete(id); }
    for (const value of values) {
      let e = this.labelElements.get(value.id); if (!e) { e = document.createElement('span'); this.labels.append(e); this.labelElements.set(value.id, e); }
      e.className = `world-label label-${value.type}${value.variant === undefined ? '' : ` variant-${value.variant}`}`; e.textContent = value.text; e.style.transform = `translate(${value.x}px,${value.y}px) translate(-50%,-100%)`;
    }
  }
  showClue(clue: SymbolId[], restored = false) { this.clue = [...clue]; if (!restored) this.toast(this.s?.mode === 'solo' ? 'Đã ghi nhớ gợi ý. Mang từng mô-đun đến bảng điện theo thứ tự này.' : 'Gợi ý chỉ hiện cho bạn. Nhấn 1, 2, 3 để báo từng biểu tượng.'); if (this.state === 'game') this.updateHud(); }
  getClue() { return this.clue; }
  setPaused(paused: boolean, onboarding = false) {
    this.hud.classList.toggle('paused', paused);
    this.paused = paused; if (paused) this.pauseOverlay(onboarding); else { this.modal.innerHTML = ''; this.settingsOpen = false; this.labels.hidden = false; }
  }
  private pauseOverlay(onboarding: boolean) {
    if (this.state !== 'game' || this.settingsOpen || this.leaving || this.networkState === 'ended') return;
    this.labels.hidden = true;
    const online = this.networkState === 'online';
    this.modal.innerHTML = `<div class="scrim game-scrim"><section class="dialog play-dialog" role="dialog" aria-modal="true" aria-labelledby="pause-title"><span class="dialog-icon">✳</span><h2 id="pause-title">${onboarding ? 'Một bàn tay của bạn,<br>một lễ hội của cả nhóm.' : online ? 'Nghỉ một nhịp nhé.' : 'Đang tìm lại nhóm bạn…'}</h2><p>${online ? onboarding ? 'Cùng chuyển đồ, chia sẻ gợi ý và thắp sáng sân khấu. Chúng mình có 12 phút.' : 'Đồng đội vẫn đang chơi, đồng hồ vẫn chạy. Sẵn sàng thì quay lại sân.' : escape(this.networkMessage)}</p><div class="onboarding-controls"><div><kbd>W A S D</kbd><span>Di chuyển</span></div><div><kbd>Chuột</kbd><span>Nhìn quanh</span></div><div><kbd>Shift</kbd><span>Chạy nhanh</span></div><div><kbd>E</kbd><span>Nhặt / lắp / giữ trạm</span></div><div><kbd>G</kbd><span>Đặt đồ xuống</span></div><div><kbd>Q</kbd><span>Báo vị trí</span></div></div><p class="hint-line">Cổng giữa sân cần một bạn giữ E. Lối vòng phía nam luôn mở.</p><button class="primary full" data-action="play" ${online ? '' : 'disabled'}>${onboarding ? 'Vào sân · Bật điều khiển chuột' : 'Tiếp tục · Bật điều khiển chuột'}</button><div class="dialog-actions"><button class="quiet" data-action="settings">Cài đặt</button><button class="quiet" data-action="leave">Rời phòng</button></div><small>Esc để thả chuột và mở menu.</small></section></div>`; this.focusModal();
    this.soloPauseCopy(onboarding);
    if (onboarding) {
      const detail = this.modal.querySelector('.play-dialog > p');
      if (detail) detail.textContent += ' Đồng hồ đã chạy, kể cả khi đọc hướng dẫn hoặc tạm nghỉ.';
    }
  }
  private soloPauseCopy(onboarding: boolean) {
    if (this.s?.mode !== 'solo') return;
    const title = this.modal.querySelector('#pause-title');
    if (title && onboarding) title.textContent = 'Một mình, vẫn trọn một lễ hội.';
    const detail = this.modal.querySelector('.play-dialog > p');
    if (detail && this.networkState === 'online') detail.textContent = onboarding ? 'Bạn có 18 phút: chuyển dụng cụ, đọc gợi ý trong lớp, giữ trạm A rồi trạm B mỗi trạm 3 giây.' : 'Đồng hồ vẫn chạy khi tạm nghỉ hoặc mất kết nối. Sẵn sàng thì quay lại sân.';
    const hint = this.modal.querySelector('.hint-line');
    if (hint) hint.textContent = 'Tay trống: giữ E ở công tắc 1 giây để mở cổng 15 giây. Thả rồi giữ lại để mở lại. Lối vòng phía nam luôn mở.';
  }
  private showSettings() {
    this.settingsReturn = this.state === 'game' ? 'pause' : 'title';
    if (this.state === 'game') this.actions.pause(); this.settingsOpen = true;
    const slider = (label: string, key: 'music' | 'effects' | 'sensitivity', min: number, max: number) => `<label class="setting-row">${label}<output>${key === 'sensitivity' ? `${this.settings[key].toFixed(1)}×` : `${Math.round(this.settings[key] * 100)}%`}</output><input type="range" data-setting="${key}" min="${min}" max="${max}" step="0.05" value="${this.settings[key]}" aria-label="${label}"></label>`;
    this.modal.innerHTML = `<div class="scrim"><section class="dialog settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title"><div class="sheet-heading"><h2 id="settings-title">Vừa ý bạn</h2><button class="quiet close" data-action="close-settings" aria-label="Đóng cài đặt">×</button></div><p>Âm thanh và cảm giác điều khiển của riêng bạn.</p>${slider('Nhạc sân trường', 'music', 0, 1)}${slider('Hiệu ứng & bước chân', 'effects', 0, 1)}${slider('Độ nhạy chuột', 'sensitivity', .3, 2.5)}<label class="setting-row">Chất lượng hình ảnh<select data-setting="quality" aria-label="Chất lượng hình ảnh"><option value="high" ${this.settings.quality === 'high' ? 'selected' : ''}>Đẹp · Bóng nắng mềm</option><option value="low" ${this.settings.quality === 'low' ? 'selected' : ''}>Nhẹ · Ưu tiên mượt</option></select></label><label class="checkbox-row"><input type="checkbox" data-setting="reducedMotion" ${this.settings.reducedMotion ? 'checked' : ''}>Giảm chuyển động trang trí</label><p class="mini-note">Tự lưu trên trình duyệt này. Nhạc và hiệu ứng được sáng tác tổng hợp riêng cho Campus Together.</p><button class="primary full" data-action="close-settings">Xong rồi</button></section></div>`; this.focusModal();
  }
  private closeSettings() { this.settingsOpen = false; if (this.settingsReturn === 'pause') this.pauseOverlay(false); else this.modal.innerHTML = ''; }
  private results() {
    const s = this.s!, mission = missionView(s); this.state = 'results'; this.screen.hidden = false; this.hud.hidden = true; this.labels.hidden = true;
    const signature = JSON.stringify([s.roundId, s.result, s.score, s.leaderId, s.players.map(p => p.id)]); if (signature === this.signature) return; this.signature = signature; this.modal.innerHTML = ''; this.settingsOpen = false;
    const success = s.result === 'success';
      this.screen.innerHTML = `<section class="results-layout"><div class="result-sheet"><span class="result-seal">${success ? '✺' : '✳'}</span><p class="festival-tag">${s.mode === 'solo' ? 'Chơi một mình' : 'Chơi cùng bạn'} · ${s.durationMs / 60000} phút mỗi lượt</p><h1>${mission.title}</h1><p>${mission.detail}</p><div class="result-score"><strong>${s.score}</strong><span>${s.mode === 'solo' ? 'điểm của bạn' : 'điểm của cả nhóm'}<br><small>Tối đa 1.300 điểm</small></span></div><div class="result-details"><span>${s.targets.filter(t => t.itemId).length}/9 phần việc</span><span>${Math.floor((s.durationMs - s.remainingMs) / 60000)} phút ${Math.floor((s.durationMs - s.remainingMs) / 1000) % 60} giây</span></div><div class="result-team">${s.players.map(p => `<span><b class="avatar-badge variant-${p.variant}">${p.variant + 1}</b>${escape(p.name)}</span>`).join('')}</div>${s.leaderId === this.me ? '<button class="primary full" data-action="replay">Hẹn thêm một lượt nữa</button>' : '<p>Chờ trưởng nhóm mở lượt chơi mới.</p>'}<button class="quiet full" data-action="leave">Về sân trường</button><small>Lượt mới thay vị trí vật phẩm và gợi ý. Bấm sẵn sàng để chơi tiếp.</small></div></section>`;
    if (s.mode === 'solo') this.screen.querySelector('.result-sheet > small')!.textContent = 'Một lần bấm bắt đầu lượt Solo mới. Vào sân khi sẵn sàng điều khiển; đồng hồ vẫn chạy.';
  }
  private async copyInvite() {
    if (!this.s) return; const url = new URL(location.href); url.search = ''; url.hash = ''; url.searchParams.set('room', this.s.roomCode);
    try { await navigator.clipboard.writeText(url.href); this.toast('Đã sao chép lời mời. Gửi cho bạn bè nhé!'); }
    catch { this.toast(`Không sao chép được. Gửi mã phòng ${this.s.roomCode} cho bạn nhé.`); }
  }
  toast(message: string, error = false) { clearTimeout(this.toastTimer); this.toastBox.textContent = message; this.toastBox.className = `visible${error ? ' error' : ''}`; this.toastTimer = setTimeout(() => this.toastBox.className = '', 4400); }
  showTip(message: string) { const tip = this.hud.querySelector<HTMLElement>('#first-use-tip'); if (!tip) return; clearTimeout(this.tipTimer); tip.textContent = message; tip.hidden = false; this.tipTimer = setTimeout(() => tip.hidden = true, 6000); }
  private modalFocusables() { return [...this.modal.querySelectorAll<HTMLElement>('button,input,select,a[href],[tabindex]')].filter(e => !e.matches(':disabled') && e.tabIndex >= 0 && e.getClientRects().length > 0); }
  private syncModal() {
    const open = !!this.modal.firstElementChild;
    if (open && !this.modalActive) {
      this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      this.returnAction = this.returnFocus?.dataset.action;
    }
    const wasOpen = this.modalActive; this.modalActive = open;
    for (const element of this.background) element.inert = open;
    if (open) {
      const dialog = this.modal.querySelector<HTMLElement>('[role="dialog"],[role="alertdialog"]');
      if (dialog) { dialog.setAttribute('aria-modal', 'true'); dialog.tabIndex = -1; }
      if (!this.modal.contains(document.activeElement)) this.focusModal();
    } else if (wasOpen) {
      const opener = this.returnFocus?.isConnected && this.returnFocus.getClientRects().length ? this.returnFocus :
        [...this.screen.querySelectorAll<HTMLElement>('[data-action]')].find(e => e.dataset.action === this.returnAction);
      (opener ?? this.screen.querySelector<HTMLElement>('button:not(:disabled),input') ?? this.canvas).focus();
      this.returnFocus = null; this.returnAction = undefined;
    }
  }
  private focusModal() { queueMicrotask(() => { if (!this.modal.firstElementChild) return; (this.modalFocusables()[0] ?? this.modal.querySelector<HTMLElement>('[role="dialog"],[role="alertdialog"]'))?.focus(); }); }
  reset() { this.s = null; this.me = ''; this.clue = []; this.networkState = 'idle'; this.network.hidden = true; this.paused = false; this.labels.innerHTML = ''; this.labelElements.clear(); this.title(); }
  dispose() { this.abort.abort(); this.modalObserver.disconnect(); for (const e of this.background) e.inert = false; clearTimeout(this.toastTimer); clearTimeout(this.tipTimer); }
}
