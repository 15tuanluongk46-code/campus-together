import { afterAll, beforeAll, expect, it } from 'vitest';
import { Client } from '@colyseus/sdk';
import { CollisionWorld, TARGETS } from '@campus/shared';
import { createCampusServer } from '../../apps/server/src/server.js';
import { TestClient, until, sleep } from '../helpers/client.js';

let host: Awaited<ReturnType<typeof createCampusServer>>, endpoint: string;
const peers: TestClient[] = [];
beforeAll(async () => { host = await createCampusServer(0); endpoint = `ws://127.0.0.1:${host.port}`; });
afterAll(async () => { for (const p of peers) if (p.room.connection.isOpen) await p.room.leave().catch(() => {}); await host.close(); });

it('real Solo room refuses a second join in lobby/play/reservation/replay, reconnects item and A latch, restores private clue', async () => {
  const client = new Client(endpoint);
  let a = new TestClient(await client.create('campus', { name: 'Một mình', protocol: 1, mode: 'solo' }), client); peers.push(a);
  await until(() => !!a.snapshot);
  expect(a.snapshot).toMatchObject({ mode: 'solo', phase: 'lobby', durationMs: 1080000 });
  const denied = () => expect(TestClient.join(endpoint, a.room.roomId)).rejects.toThrow();
  await denied(); await a.act({ type: 'ready', ready: true }); expect((await a.act({ type: 'start' })).ok).toBe(true);
  await until(() => a.snapshot.phase === 'supply'); await denied();
  const w = await CollisionWorld.create();
  const target = (id: string) => TARGETS.find(t => t.id === id)!.position;
  const reconnect = async (delay = 650) => {
    const old = a, token = a.room.reconnectionToken;
    old.room.connection.close(4010); await sleep(delay); await denied();
    a = new TestClient(await client.reconnect(token), client); peers.push(a); await until(() => !!a.snapshot);
    expect(a.room.sessionId).toBe(old.room.sessionId);
  };
  const deliver = async (itemId: string, targetId: string) => {
    const item = () => a.snapshot.items.find(i => i.id === itemId)!;
    await a.walk(w, item().position); expect((await a.act({ type: 'pickup', itemId, expectedRevision: item().revision })).code).toBe('OK');
    await until(() => a.player.heldItemId === itemId); await a.walk(w, target(targetId));
    expect((await a.act({ type: 'place', itemId, targetId, expectedRevision: item().revision })).code).toBe('OK');
    await until(() => a.player.heldItemId === null);
  };
  const hold = async (targetId: 'station-a' | 'station-b', ms: number) => {
    const end = Date.now() + ms;
    while (Date.now() < end && a.snapshot.phase !== 'results' && !(targetId === 'station-a' && a.snapshot.stationAComplete)) {
      const response = await a.act({ type: 'hold', targetId, active: true });
      // Result arrives immediately; 15Hz snapshot can still show pre-completion.
      // Accept only the precise terminal refusal AND its authoritative follow-up.
      if (!response.ok && targetId === 'station-a' && response.code === 'OCCUPIED') {
        await until(() => a.snapshot.stationAComplete); break;
      }
      if (!response.ok && targetId === 'station-b' && response.code === 'WRONG_PHASE') {
        await until(() => a.snapshot.phase === 'results' && a.snapshot.result === 'success'); break;
      }
      expect(response.ok, JSON.stringify({ response, phase: a.snapshot.phase, latch: a.snapshot.stationAComplete, progress: a.snapshot.launchProgressMs })).toBe(true);
      await sleep(120);
    }
  };
  try {
    await a.walk(w, a.snapshot.items[0]!.position);
    expect((await a.act({ type: 'pickup', itemId: 'crate-a', expectedRevision: 0 })).ok).toBe(true);
    await until(() => a.player.heldItemId === 'crate-a'); await reconnect(3200);
    expect(a.player.heldItemId).toBeNull(); expect(a.snapshot.items[0]).toMatchObject({ state: 'WORLD', revision: 2 });
    for (const [i, t] of [['crate-a', 'decor-a'], ['crate-b', 'decor-b'], ['cable', 'cable-socket'], ['fuse', 'fuse-socket']] as const) await deliver(i, t);
    await until(() => a.snapshot.phase === 'power'); await a.walk(w, target('clue-board'));
    const clue = (await a.act({ type: 'read-clue' })).clue!; expect(clue).toHaveLength(3);
    await reconnect(); await until(() => !!a.clue); expect(a.clue).toEqual(clue); expect(a.snapshot).not.toHaveProperty('clue');
    for (const [slot, symbol] of clue.entries()) await deliver(`module-${symbol}`, `power-${slot}`);
    await until(() => a.snapshot.phase === 'launch'); await a.walk(w, target('station-a'));
    await hold('station-a', 1200); await reconnect(); expect(a.snapshot).toMatchObject({ stationAComplete: false, launchProgressMs: 0 });
    await hold('station-a', 3600); await until(() => a.snapshot.stationAComplete); await reconnect();
    expect(a.snapshot.stationAComplete).toBe(true);
    await a.walk(w, target('station-b')); await hold('station-b', 3600);
    await until(() => a.snapshot.phase === 'results'); expect(a.snapshot).toMatchObject({ result: 'success', score: 1200 });
    const oldRound = a.snapshot.roundId;
    const request = { type: 'replay', requestId: 'socket-replay', roundId: oldRound } as const;
    a.room.send('intent', request); await until(() => a.results.some(r => r.requestId === request.requestId));
    expect(a.results.find(r => r.requestId === request.requestId)).toMatchObject({ ok: true, roundId: oldRound + 1 });
    await until(() => a.snapshot.phase === 'supply'); await denied();
    const replies = a.results.length; a.room.send('intent', request);
    await until(() => a.results.length > replies); expect(a.results.at(-1)!.code).toBe('OLD_ROUND');
    expect(a.snapshot).toMatchObject({ mode: 'solo', stationAComplete: false, roundId: 2, score: 0 });
    const id = a.room.roomId; await a.room.leave(); await sleep(250);
    await expect(client.joinById(id, { name: 'Mới', protocol: 1 })).rejects.toThrow();
  } finally { w.dispose(); }
}, 300000);

it('creation validates mode and legacy rooms stay coop even after departure', async () => {
  await expect(new Client(endpoint).create('campus', { name: 'Sai', protocol: 1, mode: 'creative' })).rejects.toThrow();
  const a = await TestClient.create(endpoint); peers.push(a);
  const b = await TestClient.join(endpoint, a.room.roomId); peers.push(b);
  expect(a.snapshot.mode).toBe('coop'); await b.room.leave();
  await until(() => a.snapshot.players.length === 1); expect(a.snapshot.mode).toBe('coop');
  await a.act({ type: 'ready', ready: true }); expect((await a.act({ type: 'start' })).code).toBe('NOT_READY');
  await expect(new Client(endpoint).joinById(a.room.roomId, { name: 'Đổi', protocol: 1, mode: 'solo' })).rejects.toThrow();
});

it('sync flood sends at most one identity refresh per 500ms then refills', async () => {
  const a = await TestClient.create(endpoint); peers.push(a); let count = 0;
  a.room.onMessage('welcome', () => count++); await sleep(550);
  for (let i = 0; i < 20; i++) a.room.send('sync', { protocol: 1 });
  await sleep(160); expect(count).toBe(1);
  await sleep(510); a.room.send('sync', { protocol: 1 }); await until(() => count === 2);
});
