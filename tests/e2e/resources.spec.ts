import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { enter, observe } from './helpers.js';
import { TestClient, browserEndpoint } from '../helpers/client.js';
import { instrumentResources, resources, renderedFrames } from './resource-meter.js';
import { snapshot } from '../client/fixtures.js';
import { ITEM_LAYOUTS } from '@campus/shared';
test.use({ trace: 'off' });

test('resource lifecycle: repeated actual sessions have an exactly stable warm tail', async ({ page }, info) => {
  const peers: TestClient[] = []; const cycles = [];
  await instrumentResources(page); const view = observe(page);
  // Test-only capture of the renderer owner, without touching authority/session state.
  await page.route('**/src/scene.ts', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      const observedRender = CampusScene.prototype.render;
      CampusScene.prototype.render = function(...args) { window.resourceScene = this; return observedRender.apply(this, args); };` });
  });
  let warm: Awaited<ReturnType<typeof resources>> | undefined;
  try {
    await enter(page, 'Tài nguyên'); await page.getByRole('button', { name: 'Rời phòng', exact: true }).click();
    await page.getByRole('button', { name: 'Mở cài đặt' }).click();
    await page.getByLabel('Chất lượng hình ảnh').selectOption('low');
    await page.getByRole('button', { name: 'Xong rồi' }).click();
    for (let i = 0; i < 10; i++) {
      await page.getByRole('button', { name: /Tạo phòng cùng bạn/ }).click();
      await expect(page.locator('#invite-code')).toBeVisible();
      const peer = await TestClient.join(browserEndpoint, await page.locator('#invite-code').innerText()); peers.push(peer);
      await peer.act({ type: 'ready', ready: true });
      await page.getByRole('button', { name: 'Mình sẵn sàng' }).click(); await page.getByRole('button', { name: 'Cùng vào sân trường' }).click();
      await expect(page.getByRole('button', { name: 'Vào sân · Bật điều khiển chuột' })).toBeVisible();
      await renderedFrames(page);
      if (i === 0) {
        // compile traverses ALL cached source meshes (not just camera-visible props),
        // including skinning, double-sided, instancing/color, fog and shadow variants.
        // Both quality settings are explicit; random room layout is not a warmup signal.
        await page.evaluate(() => {
          const owner = (window as any).resourceScene;
          const original = owner.renderer.shadowMap.enabled;
          for (const shadows of [true, false]) {
            owner.renderer.shadowMap.enabled = shadows;
            owner.renderer.compile(owner.scene, owner.camera);
            for (const model of owner.assets.models.values()) owner.renderer.compile(model.scene, owner.camera, owner.scene);
          }
          owner.renderer.shadowMap.enabled = original;
        });
        await renderedFrames(page);
      }
      const active = await resources(page);
      await page.getByRole('button', { name: 'Rời phòng', exact: true }).click();
      await page.getByRole('button', { name: 'Rời lượt chơi', exact: true }).click(); await peer.room.leave(); peers.pop();
      await renderedFrames(page);
      const cdp = await page.context().newCDPSession(page);
      let heap;
      try { await cdp.send('HeapProfiler.collectGarbage'); heap = await cdp.send('Runtime.getHeapUsage'); } finally { await cdp.detach(); }
      cycles.push({ cycle: i, layout: view.snapshot!.layout, active: active.counters, ...(await resources(page)), heap });
      if (i === 0) warm = await resources(page);
    }
    const raw = await resources(page);
    const variants = raw.events.filter(e => e.kind === 'link').map(e => ({ id: e.id, frame: e.frame,
      vertexHash: createHash('sha256').update(e.vertex ?? '').digest('hex'), fragmentHash: createHash('sha256').update(e.fragment ?? '').digest('hex'),
      vertexDefines: e.vertex?.split('\n').filter(l => l.startsWith('#define')), fragmentDefines: e.fragment?.split('\n').filter(l => l.startsWith('#define')) }));
    await writeFile(info.outputPath('shader-sources.json'), JSON.stringify(raw.events, null, 2));
    await writeFile(info.outputPath('resource-cycles.json'), JSON.stringify({ warm: warm?.counters, cycles: cycles.map(({ events, ...c }) => c), variants }, null, 2));
    for (const cycle of cycles.slice(1)) {
      expect(cycle.counters, `post-warmup cycle ${cycle.cycle}`).toEqual(warm!.counters);
      expect(cycle.programs, 'stable count must not hide program churn').toEqual(warm!.programs);
      expect(cycle.contextLosses, 'a lost context must not mask a leak').toEqual([]);
    }
    expect(view.errors).toEqual([]);
  } finally { for (const p of peers) if (p.room.connection.isOpen) await p.room.leave(); }
});

test('resource sampler reads fresh allocations and idempotent deletes, then accounts for context loss', async ({ page }) => {
  await instrumentResources(page);
  await page.goto('/'); await page.waitForLoadState('networkidle');
  await expect(page.getByRole('button', { name: /Tạo phòng cùng bạn/ })).toBeEnabled({ timeout: 60000 });
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect.poll(async () => (await resources(page)).counters).toEqual({ buffers: 0, textures: 0, programs: 0 });
  const observation = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); document.body.append(canvas);
    const gl = canvas.getContext('webgl2')!;
    const read = () => (window as any).resourceMeter.read().counters;
    const before = read(); const buffer = gl.createBuffer(), texture = gl.createTexture(), program = gl.createProgram();
    const allocated = read(); gl.deleteBuffer(buffer); gl.deleteBuffer(buffer); gl.deleteTexture(null); gl.deleteTexture(texture); gl.deleteProgram(program);
    const deleted = read();
    gl.createBuffer(); // must be released by context loss, not a delete call
    const abandoned = read(); gl.getExtension('WEBGL_lose_context')!.loseContext();
    return { before, allocated, deleted, abandoned };
  });
  expect(observation.before).toEqual({ buffers: 0, textures: 0, programs: 0 });
  expect(observation.allocated).toEqual({ buffers: 1, textures: 1, programs: 1 });
  expect(observation.deleted).toEqual(observation.before);
  expect(observation.abandoned).toEqual({ buffers: 1, textures: 0, programs: 0 });
  await expect.poll(async () => (await resources(page)).counters).toEqual(observation.before);
});

test('shader characterization: quality creates shadow variants; all three layouts reuse warmed programs', async ({ page }, info) => {
  await instrumentResources(page);
  await page.goto('/'); await page.waitForLoadState('networkidle');
  await expect(page.getByRole('button', { name: /Tạo phòng cùng bạn/ })).toBeEnabled({ timeout: 60000 });
  const rows = await page.evaluate(async s => {
    window.dispatchEvent(new Event('pagehide')); await new Promise(resolve => setTimeout(resolve, 50));
    const path = '/src/scene.ts'; const { CampusScene } = await import(/* @vite-ignore */ path);
    document.querySelector('#app')!.innerHTML = '<canvas id="probe" style="width:100vw;height:100vh"></canvas>';
    const owner = new CampusScene(document.querySelector('#probe'), { quality: 'high', music: 0, effects: 0, sensitivity: 1, reducedMotion: false });
    await owner.load(() => {}, new AbortController().signal);
    const me = s.players[0]!; owner.render(s, s.players, me.id, me.position, 0, .42, 'play', null, 1 / 60, 0);
    const rows = [];
    for (const quality of ['high', 'low']) {
      owner.applySettings({ ...owner.settings, quality });
      owner.renderer.compile(owner.scene, owner.camera);
      for (const model of owner.assets.models.values()) owner.renderer.compile(model.scene, owner.camera, owner.scene);
      rows.push({ quality, ...(window as any).resourceMeter.read() });
    }
    Object.assign(window, { shaderOwner: owner }); return rows;
  }, snapshot());
  const layouts = [];
  try {
    for (const [layout, items] of ITEM_LAYOUTS.entries()) {
      const s = snapshot({ layout, items: items.map(i => ({ ...i, state: 'WORLD', holderId: null, targetId: null, revision: 0 })) });
      await page.evaluate(s => {
        const owner = (window as any).shaderOwner; owner.resetSession();
        const me = s.players[0]!;
        owner.render(s, s.players, me.id, me.position, 0, .42, 'play', null, 1 / 60, 0);
      }, s);
      layouts.push({ layout, ...(await resources(page)) });
    }
    await writeFile(info.outputPath('shader-characterization.json'), JSON.stringify({ rows, layouts }, null, 2));
    const high = new Set<number>(rows[0].programs);
    const additions = rows[1].events.filter((e: any) => e.kind === 'link' && !high.has(e.id));
    expect(additions.length).toBeGreaterThan(0);
    expect(additions.some((e: any) => e.vertex.includes('#define SHADER_TYPE MeshStandardMaterial') && e.vertex.includes('#define DOUBLE_SIDED') && !e.vertex.includes('#define USE_SHADOWMAP'))).toBe(true);
    for (const layout of layouts) expect(layout.programs).toEqual(rows[1].programs);
  } finally { await page.evaluate(() => (window as any).shaderOwner.dispose()); }
});
