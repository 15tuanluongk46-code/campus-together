import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { enter } from './helpers.js';
import { TestClient, browserEndpoint } from '../helpers/client.js';
test.use({ trace: 'off' });

test('original audio output is non-silent/unclipped and canvas animation records actual frames', async ({ page }, info) => {
  await page.goto('/'); await page.waitForLoadState('networkidle');
  await expect(page.getByRole('button', { name: /Tạo phòng cùng bạn/ })).toBeEnabled({ timeout: 60000 });
  // Record the actual animated title canvas; this adds no actor/state bypass.
  const video = await page.evaluate(async () => {
    const stream = document.querySelector<HTMLCanvasElement>('#campus')!.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 2500000 });
    const chunks: Blob[] = []; recorder.ondataavailable = e => chunks.push(e.data);
    const stopped = new Promise<void>(resolve => recorder.onstop = () => resolve()); recorder.start();
    await new Promise(resolve => setTimeout(resolve, 5000)); recorder.stop(); await stopped;
    stream.getTracks().forEach(t => t.stop());
    return [...new Uint8Array(await new Blob(chunks).arrayBuffer())];
  });
  await writeFile(info.outputPath('campus-animation.webm'), Buffer.from(video));
  // Isolated real audio owner; tap its actual master output before destination.
  const sound = await page.evaluate(async () => {
    window.dispatchEvent(new Event('pagehide'));
    const path = '/src/audio.ts'; const { CampusAudio } = await import(/* @vite-ignore */ path);
    const connect = AudioNode.prototype.connect; let analyser: AnalyserNode | undefined, stream: MediaStreamAudioDestinationNode | undefined;
    AudioNode.prototype.connect = function(this: AudioNode, ...args: any[]) {
      if (args[0] instanceof AudioDestinationNode) {
        const ctx = this.context as AudioContext; analyser = ctx.createAnalyser(); analyser.fftSize = 2048;
        stream = ctx.createMediaStreamDestination(); Reflect.apply(connect, this, [analyser]); Reflect.apply(connect, this, [stream]);
      }
      return Reflect.apply(connect, this, args);
    };
    const audio = new CampusAudio({ music: 1, effects: 1, quality: 'high', sensitivity: 1, reducedMotion: false });
    await audio.activate(); AudioNode.prototype.connect = connect;
    const recorder = new MediaRecorder(stream!.stream, { mimeType: 'audio/webm;codecs=opus' }); const chunks: Blob[] = [];
    recorder.ondataavailable = e => chunks.push(e.data); const stopped = new Promise<void>(resolve => recorder.onstop = () => resolve()); recorder.start();
    let peak = 0, squares = 0, count = 0;
    const patterns = ['ui', 'pickup', 'place', 'drop', 'ping', 'error', 'phase', 'win'];
    for (let i = 0; i < 80; i++) {
      if (i % 10 === 0) audio.play(patterns[i / 10]);
      audio.footstep(5.5, .1);
      const buffer = new Float32Array(2048); analyser!.getFloatTimeDomainData(buffer);
      for (const value of buffer) { peak = Math.max(peak, Math.abs(value)); squares += value * value; count++; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    recorder.stop(); await stopped; audio.dispose();
    return { peak, rms: Math.sqrt(squares / count), samples: count, bytes: [...new Uint8Array(await new Blob(chunks).arrayBuffer())] };
  });
  expect(sound.peak).toBeGreaterThan(.01); expect(sound.peak).toBeLessThan(.98); expect(sound.rms).toBeGreaterThan(.001);
  await writeFile(info.outputPath('original-audio.webm'), Buffer.from(sound.bytes));
  await writeFile(info.outputPath('audio-signal.json'), JSON.stringify({ peak: sound.peak, rms: sound.rms, samples: sound.samples, volume: 'both buses 100%', note: 'signal-level only; no human listening verdict' }, null, 2));
});

test('profile actual one-renderer three-socket scene CPU without trace screencast', async ({ page }, info) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const peers: TestClient[] = [];
  try {
    await enter(page, 'Profile'); const code = await page.locator('#invite-code').innerText();
    for (let i = 0; i < 3; i++) { const p = await TestClient.join(browserEndpoint, code); peers.push(p); await p.act({ type: 'ready', ready: true }); }
    await page.getByRole('button', { name: 'Mình sẵn sàng' }).click(); await page.getByRole('button', { name: 'Cùng vào sân trường' }).click(); await page.getByRole('button', { name: 'Vào sân · Bật điều khiển chuột' }).click();
    await page.waitForTimeout(2000);
    const cdp = await page.context().newCDPSession(page); await cdp.send('Profiler.enable'); await cdp.send('Profiler.start'); await page.waitForTimeout(5000);
    const { profile } = await cdp.send('Profiler.stop'); await cdp.detach();
    await writeFile(info.outputPath('client.cpuprofile'), JSON.stringify(profile));
    const rows = profile.nodes.filter(n => n.hitCount).sort((a, b) => (b.hitCount ?? 0) - (a.hitCount ?? 0)).slice(0, 30).map(n => ({ ...n.callFrame, hits: n.hitCount }));
    await writeFile(info.outputPath('cpu-hotspots.json'), JSON.stringify(rows, null, 2));
  } finally { for (const p of peers) await p.room.leave(); }
});
