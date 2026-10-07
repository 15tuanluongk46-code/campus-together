export class PointerLockBusy extends Error {}
interface ActivationEffects {
  valid(): boolean;
  lock(): Promise<void>;
  audio(): Promise<void>;
  playing(): void;
  failed(): void;
  busy?(): void;
  silent(): void;
}
/** One owner per explicit gesture. Cancellation invalidates every asynchronous effect. */
export class PlayActivation {
  private generation = 0;
  private pending: Promise<void> | null = null;
  constructor(private effects: ActivationEffects) {}
  cancel() { this.generation++; this.pending = null; }
  start(): Promise<void> {
    if (this.pending) return this.pending;
    if (!this.effects.valid()) return Promise.resolve();
    const token = ++this.generation;
    const current = () => token === this.generation && this.effects.valid();
    // Both APIs are invoked inside the gesture, before yielding user activation.
    let lock: Promise<void>;
    try { lock = this.effects.lock(); } catch (error) { lock = Promise.reject(error); }
    let audio: Promise<boolean>;
    try { audio = this.effects.audio().then(() => true, () => false); } catch { audio = Promise.resolve(false); }
    const pending = (async () => {
      try { await lock; } catch (error) {
        if (current()) { if (error instanceof PointerLockBusy) this.effects.busy?.(); else this.effects.failed(); }
        return;
      }
      if (!current()) return;
      this.effects.playing();
      if (!await audio && current()) this.effects.silent();
    })().finally(() => { if (token === this.generation) this.pending = null; });
    this.pending = pending; return pending;
  }
}
