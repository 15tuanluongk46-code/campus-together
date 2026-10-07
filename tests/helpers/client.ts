import { Client, type Room } from '@colyseus/sdk';
import type { GameSnapshot, Intent, IntentResult, Vec3, Welcome, SymbolId, PrivateClue } from '../../packages/shared/src/protocol.js';
import { CollisionWorld, distance } from '../../packages/shared/src/movement.js';
import { route } from './navigation.js';

export const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
export const browserServerPort = Number(process.env.CAMPUS_TEST_PORT ?? 2667);
export const browserEndpoint = `ws://127.0.0.1:${browserServerPort}`;
export async function until(check: () => boolean, timeout = 5000): Promise<void> {
  const end = Date.now() + timeout;
  while (!check()) { if (Date.now() > end) throw new Error('Timed out waiting for observable client state'); await sleep(15); }
}
type Action = Intent extends infer T ? T extends Intent ? Omit<T, 'requestId' | 'roundId'> : never : never;
export class TestClient {
  snapshot!: GameSnapshot;
  welcome?: Welcome;
  clue?: SymbolId[];
  readonly results: IntentResult[] = [];
  private request = 0;
  private readonly prefix = crypto.randomUUID();
  private seq = 0;
  private lastRound = 0;
  constructor(readonly room: Room, readonly client: Client) {
    room.onMessage('welcome', (data: Welcome) => { this.welcome = data; });
    room.onMessage('clue', (data: PrivateClue) => { if (data.roundId === this.snapshot?.roundId) this.clue = data.clue; });
    room.onMessage('snapshot', (data: GameSnapshot) => {
      this.snapshot = data;
      if (this.lastRound !== data.roundId) { this.seq = 0; this.lastRound = data.roundId; }
      this.seq = Math.max(this.seq, (data.players.find(p => p.id === room.sessionId)?.ackSeq ?? -1) + 1);
    });
    room.onMessage('result', (data: IntentResult) => this.results.push(data));
    room.onMessage('sessionEnd', () => {});
    room.reconnection.enabled = false;
    room.send('sync', { protocol: 1 });
  }
  static async create(endpoint: string, name = 'An') {
    const client = new Client(endpoint);
    const peer = new TestClient(await client.create('campus', { name, protocol: 1 }), client);
    await until(() => !!peer.snapshot); return peer;
  }
  static async join(endpoint: string, code: string, name = 'Bình') {
    const client = new Client(endpoint);
    const peer = new TestClient(await client.joinById(code, { name, protocol: 1 }), client);
    await until(() => !!peer.snapshot); return peer;
  }
  async act(body: Action): Promise<IntentResult> {
    const requestId = `${this.prefix}_${++this.request}`;
    this.room.send('intent', { ...body, requestId, roundId: this.snapshot.roundId });
    await until(() => this.results.some(r => r.requestId === requestId));
    return this.results.find(r => r.requestId === requestId)!;
  }
  input(x: number, z: number, sprint = true): void {
    this.room.send('input', { seq: ++this.seq, roundId: this.snapshot.roundId, x, z, sprint });
  }
  get player() { return this.snapshot.players.find(p => p.id === this.room.sessionId)!; }
  async walk(world: CollisionWorld, target: Vec3): Promise<void> {
    world.setGate(this.snapshot.gateOpen);
    for (const waypoint of route(world, this.player.position, target)) {
      const end = Date.now() + 20_000;
      while (distance(this.player.position, waypoint) > .22) {
        if (Date.now() > end) throw new Error(`Network bot stuck at ${JSON.stringify(this.player.position)} to ${JSON.stringify(waypoint)}`);
        const p = this.player.position; const d = distance(p, waypoint);
        const scale = Math.min(1, d / .65);
        this.input((waypoint.x - p.x) / d * scale, (waypoint.z - p.z) / d * scale);
        await sleep(50);
      }
    }
    this.input(0, 0, false); await sleep(100);
  }
}
