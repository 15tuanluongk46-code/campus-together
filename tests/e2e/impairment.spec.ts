import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { enter, observe } from './helpers.js';
import { TestClient, browserEndpoint, browserServerPort } from '../helpers/client.js';
import { impairmentProxy } from '../helpers/impairment.js';

test('browser prediction and session recover through delayed/jittered/dropped actual WS frames', async ({ page }, info) => {
  const proxy = await impairmentProxy(browserServerPort); let peer: TestClient | undefined;
  const view = observe(page);
  try {
    await page.addInitScript(endpoint => {
      const Native = window.WebSocket;
      window.WebSocket = class extends Native {
        constructor(url: string | URL, protocols?: string | string[]) {
          const parsed = new URL(String(url)); const target = new URL(endpoint);
          if (parsed.host === location.host && parsed.pathname.split('/').length === 3) { parsed.host = target.host; parsed.protocol = target.protocol; }
          super(parsed, protocols);
        }
      };
    }, proxy.endpoint);
    await enter(page, 'Mạng chập chờn'); const code = await page.locator('#invite-code').innerText();
    peer = await TestClient.join(browserEndpoint, code); await peer.act({ type: 'ready', ready: true });
    await page.getByRole('button', { name: 'Mình sẵn sàng' }).click(); await page.getByRole('button', { name: 'Cùng vào sân trường' }).click();
    await page.getByRole('button', { name: 'Vào sân · Bật điều khiển chuột' }).click();
    await expect.poll(() => page.evaluate(() => !!document.pointerLockElement)).toBe(true);
    const id = view.welcome!.playerId, before = { ...view.snapshot!.players.find(p => p.id === id)!.position };
    proxy.enable(true);
    for (let i = 0; i < 5; i++) { await page.keyboard.press('KeyS', { delay: 130 }); await page.waitForTimeout(100); }
    await page.waitForTimeout(1200);
    const after = { ...view.snapshot!.players.find(p => p.id === id)!.position };
    expect(after.z).toBeGreaterThan(before.z + .3); expect(after.z).toBeLessThan(before.z + 5);
    await page.waitForTimeout(700); expect(view.snapshot!.players.find(p => p.id === id)!.position).toEqual(after);
    const seq = view.input!.seq; proxy.disconnect();
    await expect(page.getByRole('heading', { name: 'Đang tìm lại nhóm bạn…' })).toBeVisible();
    proxy.enable(false);
    await expect(page.getByRole('button', { name: 'Tiếp tục · Bật điều khiển chuột' })).toBeEnabled({ timeout: 20000 });
    await page.getByRole('button', { name: 'Tiếp tục · Bật điều khiển chuột' }).click();
    await page.keyboard.press('KeyW', { delay: 300 }); await expect.poll(() => view.input!.seq).toBeGreaterThan(seq);
    expect(view.welcome!.playerId).toBe(id);
    expect(view.snapshot!.items.every(i => i.state === 'WORLD' && i.revision === 0)).toBe(true);
    expect(proxy.stats.dropped).toBeGreaterThan(0); expect(view.errors).toEqual([]);
    await writeFile(info.outputPath('browser-impairment.json'), JSON.stringify({ before, after, sequenceBefore: seq, sequenceAfter: view.input!.seq, ...proxy.stats, errors: view.errors, warnings: view.warnings }, null, 2));
  } finally { await peer?.room.leave(); await page.close(); await proxy.close(); }
});
