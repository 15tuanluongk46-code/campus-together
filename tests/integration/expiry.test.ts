import { expect, it } from 'vitest';
import { Client } from '@colyseus/sdk';
import { createCampusServer } from '../../apps/server/src/server.js';
import { TestClient, until } from '../helpers/client.js';

it('actual 30-second seat expiry rejects old token and actual 60-second solo grace ends the round', async () => {
  const host = await createCampusServer(0);
  const endpoint = `ws://127.0.0.1:${host.port}`;
  let a: TestClient | undefined; let b: TestClient | undefined;
  try {
    a = await TestClient.create(endpoint); b = await TestClient.join(endpoint, a.room.roomId);
    await a.act({ type: 'ready', ready: true }); await b.act({ type: 'ready', ready: true });
    await a.act({ type: 'start' }); await until(() => b!.snapshot.phase === 'supply');
    const token = a.room.reconnectionToken; const departed = a.room.sessionId;
    const started = Date.now(); a.room.connection.close(4010);
    await until(() => b!.snapshot.players.some(p => p.id === departed && !p.connected));
    expect(b.snapshot.soloRemainingMs).toBeGreaterThan(59000);
    await until(() => !b!.snapshot.players.some(p => p.id === departed), 33_000);
    expect(Date.now() - started).toBeGreaterThanOrEqual(29_500);
    await expect(new Client(endpoint).reconnect(token)).rejects.toThrow();
    await until(() => b!.snapshot.phase === 'results', 33_000);
    expect(Date.now() - started).toBeGreaterThanOrEqual(59_500);
    expect(b.snapshot.result).toBe('alone');
    expect((await b.act({ type: 'replay' })).ok).toBe(true);
    expect((await b.act({ type: 'start' })).code).toBe('NOT_READY');
  } finally {
    if (a?.room.connection.isOpen) await a.room.leave();
    if (b?.room.connection.isOpen) await b.room.leave();
    await host.close();
  }
}, 75_000);

it('graceful server shutdown tells the client the session ended and invalidates its reconnect token', async () => {
  const host = await createCampusServer(0);
  const endpoint = `ws://127.0.0.1:${host.port}`;
  const peer = await TestClient.create(endpoint);
  const events: unknown[] = [];
  peer.room.onMessage('sessionEnd', data => events.push(data));
  await host.close();
  await until(() => !peer.room.connection.isOpen);
  expect(events).toContainEqual({ code: 'SERVER_SHUTDOWN', message: 'Máy chủ đã dừng. Hãy tạo phòng mới khi kết nối lại.' });
});
