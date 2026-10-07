import { Client } from '@colyseus/sdk';
import { TestClient, until } from '../tests/helpers/client.js';
const endpoint = process.argv[2] ?? 'http://127.0.0.1:2567';
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
assert((await fetch(`${endpoint}/health`)).ok, 'health');
const ready = await fetch(`${endpoint}/ready`);
assert(ready.ok && (await ready.json()).status === 'ready', 'ready');
assert((await (await fetch(endpoint)).text()).includes('Campus Together'), 'built index');
const peers: TestClient[] = [];
try {
  const a = await TestClient.create(endpoint); peers.push(a); const b = await TestClient.join(endpoint, a.room.roomId); peers.push(b);
  await a.act({ type: 'ready', ready: true }); await b.act({ type: 'ready', ready: true }); assert((await a.act({ type: 'start' })).ok, 'start');
  await until(() => a.snapshot.phase === 'supply'); a.input(0, 1); await until(() => a.player.position.z > .1);
  const token = a.room.reconnectionToken; a.room.connection.close(4010); await until(() => b.snapshot.players.some(p => !p.connected));
  const sdk = new Client(endpoint); const restored = new TestClient(await sdk.reconnect(token), sdk); peers.push(restored); await until(() => !!restored.snapshot);
  assert(restored.room.sessionId === a.room.sessionId, 'reconnect identity');
  const solo = new TestClient(await sdk.create('campus', { name: 'Solo smoke', protocol: 1, mode: 'solo' }), sdk); peers.push(solo);
  await until(() => !!solo.snapshot);
  assert(solo.snapshot.mode === 'solo' && solo.snapshot.durationMs === 1080000, 'solo mode/duration');
  let rejected = false;
  try { const extra = await TestClient.join(endpoint, solo.room.roomId); peers.push(extra); } catch { rejected = true; }
  assert(rejected, 'solo second seat refused');
  await solo.act({ type: 'ready', ready: true }); assert((await solo.act({ type: 'start' })).ok, 'solo start');
  await until(() => solo.snapshot.phase === 'supply'); solo.input(0, 1); await until(() => solo.player.position.z > .1);
  console.log(JSON.stringify({ health: true, readiness: true, static: true, twoClients: true, phase: restored.snapshot.phase, reconnect: true, solo: { start: true, movement: true, secondJoinRejected: true, mode: solo.snapshot.mode } }));
} finally { for (const p of peers) if (p.room.connection.isOpen) await p.room.leave(); }
