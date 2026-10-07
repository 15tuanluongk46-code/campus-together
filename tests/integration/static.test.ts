import { expect, it } from 'vitest';
import { createCampusServer } from '../../apps/server/src/server.js';
it('production serves client and assets on the same origin without shadowing health or matchmaking', async () => {
  const server = await createCampusServer(0);
  try {
    const base = `http://127.0.0.1:${server.port}`;
    const home = await fetch(base); expect(home.status).toBe(200); expect(await home.text()).toContain('Campus Together');
    const asset = await fetch(`${base}/assets/manifest.json`); expect(asset.status).toBe(200); expect((await asset.json()).characters).toHaveLength(4);
    expect(await (await fetch(`${base}/health`)).json()).toEqual({ ok: true, protocol: 1 });
    expect((await fetch(`${base}/missing.glb`)).status).toBe(404);
  } finally { await server.close(); }
});
