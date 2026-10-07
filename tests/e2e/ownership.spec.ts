import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { player, snapshot } from '../client/fixtures.js';
import { instrumentResources, resources } from './resource-meter.js';
test.use({ trace: 'off' });

test('scene owner releases highlight, instanced attributes, shadow target and actor skeletons exactly once', async ({ page }, info) => {
  await instrumentResources(page);
  await page.goto('/'); await page.waitForLoadState('networkidle');
  await expect(page.getByRole('button', { name: /Tạo phòng cùng bạn/ })).toBeEnabled({ timeout: 60000 });
  const result = await page.evaluate(async s => {
    window.dispatchEvent(new Event('pagehide'));
    const path = '/src/scene.ts'; const { CampusScene } = await import(/* @vite-ignore */ path);
    const root = document.querySelector('#app')!; root.innerHTML = '';
    const canvas = document.createElement('canvas'); canvas.style.cssText = 'width:100vw;height:100vh'; root.append(canvas);
    const owner = new CampusScene(canvas, { quality: 'high', music: 0, effects: 0, sensitivity: 1, reducedMotion: false });
    await owner.load(() => {}, new AbortController().signal);
    const me = s.players[0]!;
    const counts: Record<string, number> = {};
    const track = (object: any, label: string) => { counts[label] = 0; object.addEventListener('dispose', () => { counts[label] = (counts[label] ?? 0) + 1; }); };
    const highlight = owner.scene.children.find((o: any) => o.isMesh && o.renderOrder === 10);
    track(highlight.geometry, 'highlight.geometry'); track(highlight.material, 'highlight.material');
    owner.scene.traverse((o: any) => { if (o.isInstancedMesh) track(o, `instance:${o.uuid}`); });
    const context = { position: me.position, intent: { type: 'read-clue' }, targetId: 'clue-board', label: 'Đọc', hold: false };
    for (let i = 0; i < 3; i++) { await new Promise(requestAnimationFrame); owner.render(s, [me], me.id, me.position, 0, .42, 'results', context, 1 / 60, i); }
    const skeletons = new Set<any>();
    owner.scene.traverse((o: any) => { if (o.isSkinnedMesh) skeletons.add(o.skeleton); });
    for (const skeleton of skeletons) if (skeleton.boneTexture) track(skeleton.boneTexture, `skeleton:${skeleton.uuid}`);
    const sun = owner.scene.children.find((o: any) => o.isDirectionalLight);
    track(sun.shadow.map, 'shadow.target');
    const before = (window as any).resourceMeter.read().counters;
    owner.dispose(); const after = (window as any).resourceMeter.read().counters;
    owner.dispose(); // repeated pagehide/boot cleanup is harmless
    return { counts, before, after, actors: owner.actors.size, models: owner.assets.models.size };
  }, snapshot({ phase: 'results', result: 'success', players: [player({ position: { x: 17, y: 0, z: 0 } })] }));
  await expect.poll(async () => (await resources(page)).counters).toEqual({ buffers: 0, textures: 0, programs: 0 });
  await writeFile(info.outputPath('ownership.json'), JSON.stringify({ ...result, resources: await resources(page) }, null, 2));
  for (const [name, count] of Object.entries(result.counts)) expect(count, name).toBe(1);
  expect(result.actors).toBe(0); expect(result.models).toBe(0);
});
