import { cameraInput } from './model.js';
import { PointerLockBusy } from './activation.js';
export class Input {
  readonly keys = new Set<string>();
  yaw = 0; pitch = .42; sensitivity = 1;
  enabled = false;
  private abort = new AbortController();
  private generation = 0;
  private pending = false;
  private disposed = false;
  constructor(private canvas: HTMLCanvasElement, private action: (key: string) => void, private pause: () => void, private clearCallback: () => void) {
    const options = { signal: this.abort.signal };
    window.addEventListener('keydown', e => {
      if (!this.enabled || document.pointerLockElement !== canvas || e.target instanceof HTMLInputElement) return;
      if (e.code === 'Escape') { e.preventDefault(); this.pause(); return; }
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyG', 'KeyQ', 'ShiftLeft', 'ShiftRight', 'Digit1', 'Digit2', 'Digit3'].includes(e.code)) {
        e.preventDefault(); this.keys.add(e.code); if (!e.repeat) this.action(e.code);
      }
    }, options);
    window.addEventListener('keyup', e => { this.keys.delete(e.code); if (e.code === 'KeyE' || ['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) this.clearCallback(); }, options);
    window.addEventListener('mousemove', e => { if (this.enabled && document.pointerLockElement === canvas) { this.yaw -= e.movementX * .002 * this.sensitivity; this.pitch = Math.min(1.1, Math.max(-.12, this.pitch + e.movementY * .0018 * this.sensitivity)); } }, options);
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== canvas && this.enabled) { this.clear(); this.pause(); }
      else if (document.pointerLockElement === canvas && !this.enabled && !this.pending) document.exitPointerLock();
    }, options);
    window.addEventListener('blur', () => { this.clear(); if (this.enabled) this.pause(); }, options);
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.clear(); if (this.enabled) this.pause(); } }, options);
  }
  async lock() {
    if (this.disposed) throw new Error('Pointer activation unavailable');
    if (this.pending) throw new PointerLockBusy('Previous browser request is still pending');
    const token = ++this.generation; this.pending = true;
    await new Promise<void>((resolve, reject) => {
      let settled = false, expired = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        document.removeEventListener('pointerlockchange', changed); document.removeEventListener('pointerlockerror', failed);
        this.pending = false;
        if (expired || this.disposed || token !== this.generation) {
          if (document.pointerLockElement === this.canvas) document.exitPointerLock();
          reject(new Error('Pointer activation cancelled')); return;
        }
        error ? reject(error) : resolve();
      };
      const changed = () => { if (document.pointerLockElement === this.canvas) finish(); };
      const failed = () => finish(new Error('Pointer lock denied'));
      // Timeout ends the UI attempt, NOT the browser's uncancellable request.
      // Keep one physical owner until its actual grant/error; never overlap it.
      const timer = setTimeout(() => { expired = true; reject(new Error('Pointer lock timed out')); }, 4000);
      document.addEventListener('pointerlockchange', changed); document.addEventListener('pointerlockerror', failed);
      try { const request = this.canvas.requestPointerLock(); request?.then(changed, failed); } catch { failed(); }
    });
    if (this.disposed || token !== this.generation) {
      // Physical requests are serialized: this stale request cannot own a newer lock.
      if (document.pointerLockElement === this.canvas) document.exitPointerLock();
      throw new Error('Pointer activation cancelled');
    }
    if (document.pointerLockElement !== this.canvas) throw new Error('Pointer lock lost');
    this.enabled = true;
  }
  movement() { return this.enabled && document.pointerLockElement === this.canvas ? cameraInput(this.keys, this.yaw) : { x: 0, z: 0, sprint: false }; }
  clear() { this.keys.clear(); this.clearCallback(); }
  unlock() { this.generation++; this.enabled = false; this.clear(); if (document.pointerLockElement === this.canvas) document.exitPointerLock(); }
  dispose() { this.disposed = true; this.unlock(); this.abort.abort(); }
}
