export interface FrameSample {
  scenario: string;
  fps: number;
  callbacks: number;
  raf: { p95: number | undefined };
  windowMs: number;
  buffer: number[];
  gl: string;
}
export function meetsTarget(samples: FrameSample[]) {
  const baselines = samples.filter(s => s.scenario === 'normal');
  return baselines.length > 0 && baselines.every(s =>
    Number.isFinite(s.fps) && s.fps >= 58 && Number.isFinite(s.raf.p95) && (s.raf.p95 ?? 0) > 0 && (s.raf.p95 ?? Infinity) <= 20 &&
    // Timers may fire late; FPS already divides callbacks by the ENTIRE real window.
    Number.isFinite(s.windowMs) && s.windowMs >= 14000 &&
    Number.isSafeInteger(s.callbacks) && s.callbacks > 0 && Math.abs(s.fps - s.callbacks * 1000 / s.windowMs) < .001 &&
    s.buffer[0] === 1920 && s.buffer[1] === 1080 && /NVIDIA/.test(s.gl) && !/SwiftShader|llvmpipe/i.test(s.gl));
}
