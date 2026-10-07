import { expect, it } from 'vitest';
import { PlayActivation } from '../../apps/client/src/activation.js';
function deferred() { let resolve!: () => void, reject!: (e: Error) => void; const promise = new Promise<void>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function setup() {
  let locks = 0, audioCalls = 0, playing = false, valid = true;
  const lock = deferred(), audio = deferred(), warnings: string[] = [];
  const owner = new PlayActivation({ valid: () => valid, lock: () => { locks++; return lock.promise; }, audio: () => { audioCalls++; return audio.promise; }, playing: () => { playing = true; }, failed: () => warnings.push('pointer'), silent: () => warnings.push('audio') });
  return { owner, lock, audio, warnings, invalid: () => valid = false, read: () => ({ locks, audioCalls, playing }) };
}
it('one activation owns concurrent clicks and starts despite audio rejection', async () => {
  const s = setup(); const a = s.owner.start(), b = s.owner.start();
  expect(s.read()).toMatchObject({ locks: 1, audioCalls: 1 });
  s.audio.reject(new Error('audio unavailable')); s.lock.resolve(); await Promise.all([a, b]);
  expect(s.read().playing).toBe(true); expect(s.warnings).toEqual(['audio']);
});
it('pointer failure retains paused menu and can retry independently from audio', async () => {
  const s = setup(); const pending = s.owner.start(); s.audio.resolve(); s.lock.reject(new Error('denied')); await pending;
  expect(s.read().playing).toBe(false); expect(s.warnings).toEqual(['pointer']);
  await s.owner.start(); expect(s.read().locks).toBe(2);
});
it('cancellation prevents old lock/audio completions from resurrecting play or overwriting newer activation', async () => {
  const first = deferred(), second = deferred(), firstAudio = deferred(); let calls = 0, plays = 0; const warnings: string[] = [];
  const a = new PlayActivation({ valid: () => true, lock: () => (++calls === 1 ? first.promise : second.promise), audio: () => calls === 1 ? firstAudio.promise : Promise.resolve(), playing: () => plays++, failed: () => warnings.push('pointer'), silent: () => warnings.push('audio') });
  const old = a.start(); a.cancel(); const current = a.start(); second.resolve(); await current; expect(plays).toBe(1);
  first.resolve(); firstAudio.reject(new Error('late audio')); await old;
  expect(plays).toBe(1); expect(warnings).toEqual([]);
});
it('disposed/offline session cannot be activated by a late completion', async () => {
  const s = setup(); const pending = s.owner.start(); s.invalid(); s.lock.resolve(); s.audio.resolve(); await pending;
  expect(s.read().playing).toBe(false); expect(s.warnings).toEqual([]);
});
