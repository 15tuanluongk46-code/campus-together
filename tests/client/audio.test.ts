import { afterEach, expect, it, vi } from 'vitest';
import { CampusAudio } from '../../apps/client/src/audio.js';
import { normalizeSettings } from '../../apps/client/src/model.js';
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it('failed audio initialization can recover on another gesture without leaving a partial graph', async () => {
  vi.useFakeTimers(); let calls = 0, closed = 0;
  vi.stubGlobal('AudioContext', class {
    currentTime = 0; state = 'suspended'; destination = {};
    createGain() { if (++calls === 1) throw new Error('device unavailable'); return { gain: { value: 0, setTargetAtTime() {} }, connect() {} }; }
    async close() { closed++; this.state = 'closed'; }
    async resume() { this.state = 'running'; }
  });
  const audio = new CampusAudio(normalizeSettings({}));
  await expect(audio.activate()).rejects.toThrow('device unavailable'); expect(closed).toBe(1);
  await expect(audio.activate()).resolves.toBeUndefined(); audio.dispose();
  expect(closed).toBe(2); expect(vi.getTimerCount()).toBe(0);
  await expect(audio.activate()).rejects.toThrow('disposed');
});
it('concurrent resume uses one audio owner and a late resume cannot revive disposed audio', async () => {
  vi.useFakeTimers(); let resumes = 0, resolve!: () => void;
  vi.stubGlobal('AudioContext', class {
    currentTime = 0; state = 'suspended'; destination = {};
    createGain() { return { gain: { value: 0, setTargetAtTime() {} }, connect() {} }; }
    async close() { this.state = 'closed'; }
    resume() { resumes++; return new Promise<void>(r => resolve = r); }
  });
  const audio = new CampusAudio(normalizeSettings({}));
  const first = audio.activate(), second = audio.activate(); expect(resumes).toBe(1);
  audio.dispose(); resolve();
  await expect(first).rejects.toThrow('unavailable'); await expect(second).rejects.toThrow('unavailable');
  expect(vi.getTimerCount()).toBe(0);
});
