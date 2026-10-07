import { describe, expect, it } from 'vitest';
import { meetsTarget, type FrameSample } from './verdict.js';
const sample = { scenario: 'normal', fps: 60, callbacks: 900, raf: { p95: 16.8 }, windowMs: 15000, buffer: [1920, 1080], gl: 'ANGLE (NVIDIA GeForce RTX 3060)' } satisfies FrameSample & { callbacks: number };
describe('hardware frame-pacing verdict', () => {
  it('cannot pass from only ablations or an empty run', () => {
    expect(meetsTarget([])).toBe(false);
    expect(meetsTarget([{ ...sample, scenario: 'offscreen' }])).toBe(false);
  });
  it('rejects short windows, wrong resolution and software rendering', () => {
    expect(meetsTarget([{ ...sample, windowMs: 1000 }])).toBe(false);
    expect(meetsTarget([{ ...sample, buffer: [960, 540] }])).toBe(false);
    expect(meetsTarget([{ ...sample, gl: 'ANGLE SwiftShader' }])).toBe(false);
  });
  it('rejects bursty high FPS and includes every baseline repeat', () => {
    expect(meetsTarget([{ ...sample, fps: 170, raf: { p95: 35.2 } }])).toBe(false);
    expect(meetsTarget([sample, { ...sample, fps: 49 }])).toBe(false);
    expect(meetsTarget([sample, sample])).toBe(true);
  });
  it('accepts a delayed timer with genuinely sustained cadence over the entire measured window', () => {
    expect(meetsTarget([{ ...sample, windowMs: 17500, callbacks: 1050 }])).toBe(true);
    expect(meetsTarget([{ ...sample, windowMs: 17500, fps: 900 * 1000 / 17500 }])).toBe(false);
  });
  it('rejects stale/invented FPS that disagrees with actual callbacks and elapsed time', () => {
    expect(meetsTarget([{ ...sample, callbacks: 300 }])).toBe(false);
    expect(meetsTarget([{ ...sample, callbacks: 0 }])).toBe(false);
    expect(meetsTarget([{ ...sample, callbacks: NaN }])).toBe(false);
    expect(meetsTarget([{ ...sample, windowMs: 17500 }])).toBe(false);
  });
  it('rejects invalid window and percentile numbers rather than treating them as measurements', () => {
    for (const windowMs of [NaN, Infinity, -1, 0]) expect(meetsTarget([{ ...sample, windowMs }])).toBe(false);
    for (const p95 of [NaN, Infinity, -1, 0]) expect(meetsTarget([{ ...sample, raf: { p95 } }])).toBe(false);
  });
});
