import { it, expect } from 'vitest';
import { Client } from '@colyseus/sdk';
import { createCampusServer } from '../../apps/server/src/server.js';
import { CollisionWorld, distance } from '@campus/shared';
import { TestClient, sleep, until } from '../helpers/client.js';
import { impairmentProxy } from '../helpers/impairment.js';

it('real WS proxy delays/jitters/drops application frames and reconnects without duplicate ownership or runaway movement', async () => {
  const host = await createCampusServer(0); const proxy = await impairmentProxy(host.port);
  const peers: TestClient[] = []; const world = await CollisionWorld.create();
  try {
    const a = await TestClient.create(proxy.endpoint); peers.push(a);
    const b = await TestClient.join(`ws://127.0.0.1:${host.port}`, a.room.roomId); peers.push(b);
    await a.act({ type: 'ready', ready: true }); await b.act({ type: 'ready', ready: true }); await a.act({ type: 'start' });
    await until(() => a.snapshot.phase === 'supply');
    await a.walk(world, a.snapshot.items.find(i => i.id === 'crate-a')!.position);
    proxy.enable(true);
    const intent = { type: 'pickup', requestId: 'proxy-pickup', roundId: 1, itemId: 'crate-a', expectedRevision: 0 };
    for (let i = 0; i < 6; i++) { a.room.send('intent', intent); await sleep(100); }
    await until(() => a.results.some(r => r.requestId === intent.requestId));
    await until(() => b.snapshot.items.find(i => i.id === 'crate-a')?.revision === 1);
    expect(a.results.filter(r => r.requestId === intent.requestId).every(r => r.ok)).toBe(true);
    const start = { ...b.player.position };
    const before = { ...a.player.position };
    for (let i = 0; i < 30; i++) { a.input(0, .5, false); await sleep(35); }
    a.input(0, 0); await sleep(1000);
    const settled = { ...a.player.position }; await sleep(600);
    expect(distance(settled, a.player.position)).toBeLessThan(.001);
    expect(distance(before, settled)).toBeGreaterThan(.3); expect(distance(before, settled)).toBeLessThan(3);
    expect(b.player.position).toEqual(start);
    const token = a.room.reconnectionToken; proxy.disconnect();
    await until(() => !b.snapshot.players.find(p => p.id === a.room.sessionId)?.connected);
    await until(() => b.snapshot.items.find(i => i.id === 'crate-a')!.revision === 2, 6000);
    proxy.enable(false);
    const c = new Client(proxy.endpoint); const restored = new TestClient(await c.reconnect(token), c); peers.push(restored);
    await until(() => !!restored.snapshot); expect(restored.player.heldItemId).toBeNull();
    restored.room.send('intent', intent); await until(() => restored.results.length > 0);
    expect(restored.results[0]!.ok).toBe(true);
    expect(restored.snapshot.items.find(i => i.id === 'crate-a')).toMatchObject({ revision: 2, state: 'WORLD' });
    expect(proxy.stats.dropped).toBeGreaterThan(0); expect(proxy.stats.maxQueued).toBeLessThan(128); expect(proxy.stats.connections).toBe(2);
    console.log('WS impairment evidence', JSON.stringify(proxy.stats));
  } finally {
    for (const p of peers) if (p.room.connection.isOpen) await p.room.leave();
    world.dispose(); await proxy.close(); await host.close();
  }
});
