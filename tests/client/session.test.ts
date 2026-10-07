import { afterEach, beforeEach, expect, it } from 'vitest';
import { createCampusServer } from '../../apps/server/src/server.js';
import { Session } from '../../apps/client/src/session.js';
import { sleep, until, TestClient } from '../helpers/client.js';
import type { GameSnapshot } from '@campus/shared';
import { impairmentProxy } from '../helpers/impairment.js';
let server: Awaited<ReturnType<typeof createCampusServer>>;
const sessions: Session[] = [];
beforeEach(async () => { server = await createCampusServer(0); });
afterEach(async () => { sessions.forEach(s => s.leave()); sessions.length = 0; await server.close(); });
function connect(endpoint = `ws://127.0.0.1:${server.port}`) {
  const state: { snapshots: GameSnapshot[]; id: string; statuses: string[]; messages: string[] } = { snapshots: [], id: '', statuses: [], messages: [] };
  const session = new Session(endpoint, { state: (s, message) => { state.statuses.push(s); state.messages.push(message); }, snapshot: s => state.snapshots.push(s), welcome: w => state.id = w.playerId, result: () => {}, latency: () => {} });
  sessions.push(session); return { session, state };
}
it('real socket cancellation discards late room and never announces online', async () => {
  const { session, state } = connect(); const pending = session.connect('An'); session.leave(); await pending; await sleep(150);
  expect(session.state).toBe('idle'); expect(state.snapshots).toHaveLength(0); expect(state.statuses).not.toContain('online');
});
it('concurrent create/join calls have one matchmaking owner and preserve the first intent', async () => {
  const { session, state } = connect();
  await Promise.all([session.connect('Solo owner', undefined, 'solo'), session.connect('Unexpected replacement', 'ABCDEFGH')]);
  await until(() => state.snapshots.some(s => s.phase === 'supply'));
  expect(state.statuses.filter(s => s === 'connecting')).toHaveLength(1);
  expect(state.snapshots.at(-1)).toMatchObject({ mode: 'solo', phase: 'supply' });
  expect(state.snapshots.at(-1)!.players[0]!.name).toBe('Solo owner');
});
it('unacknowledged action is not replayed and authoritative reconnect explains interruption', async () => {
  const proxy = await impairmentProxy(server.port);
  const { session, state } = connect(proxy.endpoint);
  try {
    await session.connect('An'); await until(() => !!state.snapshots.length);
    const id = state.id;
    proxy.cutNextApplication();
    expect(session.send({ type: 'ready', ready: true })).toBe(true);
    await until(() => state.statuses.includes('reconnecting'));
    await until(() => session.state === 'online');
    expect(state.id).toBe(id);
    expect(state.messages.at(-1)).toMatch(/chưa được xác nhận/);
    expect(state.snapshots.at(-1)!.players.find(p => p.id === id)!.ready).toBe(false);
    await sleep(700);
    expect(state.snapshots.at(-1)!.players.find(p => p.id === id)!.ready).toBe(false);
    session.send({ type: 'ready', ready: true });
    await until(() => state.snapshots.at(-1)!.players.find(p => p.id === id)!.ready === true);
  } finally { session.leave(); await proxy.close(); }
});
it('hold heartbeat interruption is stopped without promising an action retry', async () => {
  const proxy = await impairmentProxy(server.port);
  const { session, state } = connect(proxy.endpoint);
  try {
    await session.connect('An'); await until(() => !!state.snapshots.length);
    proxy.cutNextApplication(); session.send({ type: 'hold', targetId: 'gate-switch', active: true });
    await until(() => state.statuses.includes('reconnecting')); await until(() => session.state === 'online');
    expect(state.messages.at(-1)).toBe('Đã kết nối');
    expect(state.snapshots.at(-1)!.players[0]!.holdTarget).toBeNull();
  } finally { session.leave(); await proxy.close(); }
});
it('real session receives sync identity, authoritative ready and stops callbacks on leave', async () => {
  const { session, state } = connect(); await session.connect('An'); await until(() => !!state.snapshots.length);
  expect(state.id).toBeTruthy(); expect(session.state).toBe('online');
  session.send({ type: 'ready', ready: true });
  await until(() => state.snapshots.at(-1)!.players.find(p => p.id === state.id)!.ready);
  const peer = await TestClient.join(`ws://127.0.0.1:${server.port}`, state.snapshots.at(-1)!.roomCode);
  session.leave(); const count = state.snapshots.length; await sleep(250);
  expect(state.snapshots).toHaveLength(count); expect(session.send({ type: 'ready', ready: false })).toBe(false);
  await until(() => peer.snapshot.players.length === 1); await peer.room.leave();
});
