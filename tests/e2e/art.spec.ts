import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
test('render art audit, clone/socket isolation, matching colliders, frame/resource measurements', async ({ page }, info) => {
  test.setTimeout(120000);
  await page.goto('/'); await page.waitForLoadState('networkidle');
  await expect(page.getByRole('button', { name: /Tạo phòng cùng bạn/ })).toBeEnabled({ timeout: 60000 });
  // Local, test-only standalone renderer. No production debug API, no gameplay state injection.
  const report = await page.evaluate(async () => {
    window.dispatchEvent(new Event('pagehide')); // dispose the ordinary app before measuring one renderer
    const scenePath = '/src/scene.ts', sharedPath = '/@fs/home/sss/AI-Home/projects/campus-together/packages/shared/dist/index.js';
    const { CampusScene } = await import(/* @vite-ignore */ scenePath);
    const { COLLIDERS } = await import(/* @vite-ignore */ sharedPath);
    const canvas = document.createElement('canvas'); canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:100'; document.body.append(canvas);
    const renderer = new CampusScene(canvas, { quality: 'high', music: 0, effects: 0, sensitivity: 1, reducedMotion: true });
    const progress: number[] = []; await renderer.load((p: number) => progress.push(p), new AbortController().signal);
    const local = { x: -8, y: 0, z: 0 };
    const times: number[] = []; let previous = performance.now();
    for (let i = 0; i < 45; i++) { await new Promise(requestAnimationFrame); const now = performance.now(); renderer.render(null, [], '', local, 0, .42, 'title', null, .016, i / 60); if (i > 5) times.push(now - previous); previous = now; }
    const counters = () => {
      const info = renderer.renderer.info;
      return { geometries: info.memory.geometries, textures: info.memory.textures };
    };
    const initial = { ...counters(), calls: renderer.renderer.info.render.calls, triangles: renderer.renderer.info.render.triangles };
    const actorPath = '/src/actors.ts'; const { Actor } = await import(/* @vite-ignore */ actorPath);
    const a = new Actor(renderer.assets, 0), b = new Actor(renderer.assets, 0);
    const independentSockets = a.sockets.large !== b.sockets.large && a.sockets.small !== b.sockets.small;
    const clips = [...a.actions.keys()]; a.dispose(); b.dispose();
    const matching = COLLIDERS.map((c: { id: string; center: { x: number; y: number; z: number }; half: { x: number; y: number; z: number } }) => {
      // Batched source meshes preserve the original dimensions for audit.
      const obj = renderer.scene.getObjectByName(`collider:${c.id}`) ?? renderer.art.batchedSources.find((o: { name: string }) => o.name === `collider:${c.id}`);
      return { id: c.id, match: !!obj && obj.position.x === c.center.x && obj.position.y === c.center.y && obj.position.z === c.center.z && obj.scale.x === 2 * c.half.x && obj.scale.y === 2 * c.half.y && obj.scale.z === 2 * c.half.z };
    });
    const resourceCycles = [];
    for (let i = 0; i < 5; i++) {
      const actor = new Actor(renderer.assets, i % 4); renderer.actors.set(`cycle-${i}`, actor); renderer.scene.add(actor.root);
      actor.root.position.set(-8, 0, 0); actor.actions.get('idle').play(); actor.mixer.update(.016);
      renderer.renderer.render(renderer.scene, renderer.camera); // upload the cloned skeleton before disposal
      renderer.resetSession(); renderer.render(null, [], '', local, 0, .42, 'title', null, .016, 1);
      resourceCycles.push(counters());
    }
    renderer.render(null, [], '', local, 0, .42, 'title', null, .016, 1);
    const after = counters();
    const gl = renderer.renderer.getContext(); const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unavailable';
    Object.assign(window, { artAuditScene: renderer });
    const sorted = [...times].sort((a, b) => a - b);
    return { gpu, viewport: { width: innerWidth, height: innerHeight }, frames: times.length, meanFrameMs: times.reduce((a, b) => a + b, 0) / times.length, p95FrameMs: sorted[Math.floor(sorted.length * .95)], progressFinished: progress.at(-1), independentSockets, clips, colliders: matching, initial, after, resourceCycles };
  });
  expect(report.progressFinished).toBe(1); expect(report.independentSockets).toBe(true); expect(report.clips).toHaveLength(11); expect(report.colliders.every((c: { match: boolean }) => c.match)).toBe(true);
  expect(report.after).toEqual({ geometries: report.initial.geometries, textures: report.initial.textures });
  await page.screenshot({ path: info.outputPath('16-campus-art-audit.png') });
  await info.attach('renderer-measurements', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  await writeFile(info.outputPath('renderer-measurements.json'), JSON.stringify(report, null, 2));
  await page.evaluate(() => { const scene = (window as unknown as { artAuditScene: { dispose(): void; canvas: HTMLCanvasElement } }).artAuditScene; scene.dispose(); scene.canvas.remove(); });
});
