import { fork } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { TestClient, sleep, until } from '../tests/helpers/client.js';
const output = '.superpowers/sdd/campus/task4-load';
await mkdir(output, { recursive: true });
const child = fork('tools/load-worker.ts', [], { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
const logs: string[] = []; child.stdout?.on('data', b => logs.push(String(b))); child.stderr?.on('data', b => logs.push(String(b)));
const response = () => new Promise<any>((resolve, reject) => {
  const timer = setTimeout(() => { child.off('message', got); reject(new Error('Worker response timeout')); }, 10000);
  const got = (message: any) => { clearTimeout(timer); resolve(message); }; child.once('message', got);
});
const request = (message: string) => { const waiting = response(); child.send(message); return waiting; };
const peers: TestClient[] = [], rows = [], cleanup = [];
let inputs: ReturnType<typeof setInterval> | undefined;
try {
  const { port } = await response(); const endpoint = `ws://127.0.0.1:${port}`;
  for (const count of [1, 5, 10]) {
    while (peers.length < count * 4) {
      const leader = await TestClient.create(endpoint); const team = [leader]; peers.push(leader);
      for (let i = 0; i < 3; i++) { const p = await TestClient.join(endpoint, leader.room.roomId); team.push(p); peers.push(p); }
      for (const p of team) await p.act({ type: 'ready', ready: true }); await leader.act({ type: 'start' });
      await until(() => leader.snapshot.phase === 'supply');
    }
    let n = 0; inputs = setInterval(() => { n++; for (const p of peers) p.input(0, Math.floor(n / 20) % 2 ? .5 : -.5, false); }, 34);
    await sleep(1000); await request('reset'); await sleep(8000);
    rows.push({ rooms: count, clients: peers.length, ...await request('measure') }); clearInterval(inputs); inputs = undefined;
    for (const p of peers) p.input(0, 0);
  }
  for (const p of peers.splice(0)) await p.room.leave(); await sleep(1000);
  cleanup.push({ stage: 'after-10-rooms', ...await request('measure') });
  for (let cycle = 0; cycle < 5; cycle++) {
    const a = await TestClient.create(endpoint), b = await TestClient.join(endpoint, a.room.roomId);
    await a.act({ type: 'ready', ready: true }); await b.act({ type: 'ready', ready: true }); await a.act({ type: 'start' });
    await a.room.leave(); await b.room.leave(); await sleep(300);
    cleanup.push({ stage: `cycle-${cycle}`, ...await request('measure') });
  }
  await writeFile(`${output}/load.json`, JSON.stringify({ sample: 'isolated Node server process; 4 real WS clients/room; 8s measurement; CPU % of one core; WS application bytes before TCP overhead', rows, cleanup }, null, 2));
  console.log(JSON.stringify({ rows, cleanup }, null, 2));
} finally {
  clearInterval(inputs); for (const p of peers) if (p.room.connection.isOpen) await p.room.leave().catch(() => {});
  if (child.connected) child.send('close');
  const timer = setTimeout(() => child.kill('SIGTERM'), 10000); await new Promise<void>(resolve => child.once('exit', () => resolve())); clearTimeout(timer);
  await writeFile(`${output}/worker.log`, logs.join(''));
}
