import type { Settings } from './model.js';
/** Original pentatonic score, all sound generated locally; no sampled media. */
export class CampusAudio {
  private context: AudioContext | null = null;
  private music: GainNode | null = null;
  private effects: GainNode | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private next = 0; private beat = 0; private stepAt = 0;
  private nodes = new Set<OscillatorNode>();
  private settings: Settings;
  private disposed = false;
  private activating: Promise<void> | null = null;
  constructor(settings: Settings) { this.settings = settings; }
  activate(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Audio disposed'));
    if (this.activating) return this.activating;
    this.activating = this.startAudio().finally(() => { this.activating = null; });
    return this.activating;
  }
  private async startAudio() {
    if (!this.context) {
      const context = new AudioContext();
      try {
        const music = context.createGain(), effects = context.createGain(), master = context.createGain();
        master.gain.value = .48; master.connect(context.destination); music.connect(master); effects.connect(master);
        this.context = context; this.music = music; this.effects = effects;
        this.set(this.settings); this.next = context.currentTime + .1;
        this.timer = setInterval(() => this.schedule(), 150);
      } catch (error) { this.context = null; this.music = null; this.effects = null; void context.close().catch(() => {}); throw error; }
    }
    const context = this.context;
    await context.resume();
    if (this.disposed || this.context !== context || context.state !== 'running') throw new Error('Audio unavailable');
  }
  set(settings: Settings) {
    this.settings = settings;
    if (this.context) { this.music!.gain.setTargetAtTime(settings.music, this.context.currentTime, .1); this.effects!.gain.setTargetAtTime(settings.effects, this.context.currentTime, .1); }
  }
  private note(freq: number, time: number, duration: number, volume: number, bus: GainNode, type: OscillatorType = 'sine', pan = 0) {
    const ctx = this.context!; const osc = ctx.createOscillator(), gain = ctx.createGain(), spatial = ctx.createStereoPanner();
    osc.type = type; osc.frequency.value = freq; spatial.pan.value = pan;
    gain.gain.setValueAtTime(0, time); gain.gain.linearRampToValueAtTime(volume, time + .014); gain.gain.exponentialRampToValueAtTime(.0001, time + duration);
    osc.connect(gain); gain.connect(spatial); spatial.connect(bus); osc.start(time); osc.stop(time + duration + .03); this.nodes.add(osc);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); spatial.disconnect(); this.nodes.delete(osc); };
  }
  private schedule() {
    const ctx = this.context; if (!ctx || ctx.state !== 'running') return;
    if (this.next < ctx.currentTime) this.next = ctx.currentTime + .05;
    const melody = [0, 4, 7, 9, 7, 4, 2, 4, 0, 2, 4, 7, 4, 2, -3, 2];
    while (this.next < ctx.currentTime + .4) {
      const note = melody[this.beat % melody.length]!;
      this.note(261.63 * 2 ** (note / 12), this.next, 1.2, .13, this.music!, 'sine', Math.sin(this.beat) * .25);
      this.note(523.26 * 2 ** (note / 12), this.next, .4, .025, this.music!);
      if (this.beat % 4 === 0) { const root = [130.81, 110, 87.31, 98][Math.floor(this.beat / 4) % 4]!; this.note(root, this.next, 2.8, .13, this.music!, 'triangle'); this.note(root * 1.5, this.next, 2.6, .045, this.music!); }
      this.beat++; this.next += .46;
    }
  }
  play(kind: 'ui' | 'pickup' | 'place' | 'drop' | 'ping' | 'error' | 'phase' | 'win', pan = 0) {
    if (!this.context || this.context.state !== 'running') return;
    const patterns = { ui: [660], pickup: [392, 587], place: [523, 659, 784], drop: [294, 196], ping: [880, 660], error: [185, 174], phase: [392, 523, 659, 784], win: [523, 659, 784, 1046, 784, 1046] };
    patterns[kind].forEach((frequency, i) => this.note(frequency, this.context!.currentTime + i * .09, .35, .18, this.effects!, kind === 'error' ? 'triangle' : 'sine', pan));
  }
  footstep(speed: number, dt: number, pan = 0) {
    if (!this.context || speed < .3 || this.context.state !== 'running') { this.stepAt = 0; return; }
    this.stepAt += dt * speed;
    if (this.stepAt < 1.05) return; this.stepAt = 0;
    this.note(105 + Math.random() * 35, this.context.currentTime, .065, .2, this.effects!, 'triangle', pan);
  }
  suspend() { void this.context?.suspend().catch(() => {}); }
  dispose() { this.disposed = true; clearInterval(this.timer); for (const n of this.nodes) { try { n.stop(); } catch {} } this.nodes.clear(); void this.context?.close().catch(() => {}); this.context = null; }
}
