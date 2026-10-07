import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { player, snapshot } from '../client/fixtures.js';
import { COLLIDERS } from '@campus/shared';

test('rendered wall, corner and classroom camera stays readable without crossing solids', async ({ page }, info) => {
  await page.goto('/'); await page.waitForLoadState('networkidle');
  await expect(page.getByRole('button', { name: /Tạo phòng cùng bạn/ })).toBeEnabled({ timeout: 60000 });
  const cases = [
    { name: 'south-boundary', position: { x: -8, y: 0, z: 17.65 }, yaw: 0 },
    { name: 'storage-interior', position: { x: -16, y: 0, z: 4.45 }, yaw: 0 },
    { name: 'classroom-corner', position: { x: -8.45, y: 0, z: -14.45 }, yaw: -Math.PI * .75 },
  ];
  const reports = [];
  for (const c of cases) {
    const p = player({ position: c.position }); const s = snapshot({ players: [p] });
    const report = await page.evaluate(async ({ c, s, p }) => {
      window.dispatchEvent(new Event('pagehide'));
      const path = '/src/scene.ts'; const { CampusScene } = await import(/* @vite-ignore */ path);
      const root = document.querySelector('#app')!; root.innerHTML = '';
      const canvas = document.createElement('canvas'); canvas.style.cssText = 'width:100vw;height:100vh'; root.append(canvas);
      const scene = new CampusScene(canvas, { quality: 'high', music: 0, effects: 0, sensitivity: 1, reducedMotion: false });
      await scene.load(() => {}, new AbortController().signal);
      for (let i = 0; i < 60; i++) { await new Promise(requestAnimationFrame); scene.render(s, [p], p.id, p.position, c.yaw, .42, 'play', null, 1 / 60, i / 60); }
      const from = { x: p.position.x, y: 1.22, z: p.position.z };
      const pos = scene.camera.position;
      const distance = Math.hypot(pos.x - from.x, pos.y - from.y, pos.z - from.z);
      Object.assign(window, { cameraAudit: scene });
      return { name: c.name, from, camera: { x: pos.x, y: pos.y, z: pos.z }, distance };
    }, { c, s, p });
    reports.push(report);
    await page.screenshot({ path: info.outputPath(`${c.name}.png`) });
    await page.evaluate(() => (window as unknown as { cameraAudit: { dispose(): void } }).cameraAudit.dispose());
  }
  await writeFile(info.outputPath('camera.json'), JSON.stringify(reports, null, 2));
  if (process.env.CAMPUS_CAMERA_BASELINE !== '1') for (const r of reports) {
    expect(r.distance, r.name).toBeGreaterThan(2.5);
    // Independent sampled segment/near-plane clearance, not a call back into the camera solver.
    for (let i = 0; i <= 100; i++) for (const box of COLLIDERS) {
      const p = { x: r.from.x + (r.camera.x - r.from.x) * i / 100, y: r.from.y + (r.camera.y - r.from.y) * i / 100, z: r.from.z + (r.camera.z - r.from.z) * i / 100 };
      expect(['x', 'y', 'z'].every(a => { const axis = a as 'x' | 'y' | 'z'; return Math.abs(p[axis] - box.center[axis]) < box.half[axis] + .08; }), `${r.name} crosses ${box.id}`).toBe(false);
    }
  }
});
