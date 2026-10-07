/** Isolated test process: read-only timing/send/resource instrumentation around real authority. */
import { performance } from 'node:perf_hooks';
import { WebSocket } from 'ws';
import { Game } from '../apps/server/src/domain.js';
import { CollisionWorld } from '@campus/shared';
import { createCampusServer } from '../apps/server/src/server.js';
let ticks: number[] = [], bytes = 0, frames = 0, disposed = 0, cpu = process.cpuUsage(), start = performance.now();
const tick = Game.prototype.tick;
Game.prototype.tick = function(...args) { const before = performance.now(); try { return tick.apply(this, args); } finally { ticks.push(performance.now() - before); } };
const dispose = CollisionWorld.prototype.dispose;
CollisionWorld.prototype.dispose = function() { disposed++; return dispose.call(this); };
const send = WebSocket.prototype.send;
WebSocket.prototype.send = function(this: WebSocket, ...args: Parameters<typeof send>) {
  const data = args[0]; bytes += typeof data === 'string' ? Buffer.byteLength(data) : Buffer.isBuffer(data) ? data.length : data instanceof ArrayBuffer ? data.byteLength : 0; frames++;
  return Reflect.apply(send, this, args);
} as typeof send;
const host = await createCampusServer(0);
process.send?.({ port: host.port });
process.on('message', async (message: string) => {
  if (message === 'reset') { ticks = []; bytes = 0; frames = 0; cpu = process.cpuUsage(); start = performance.now(); process.send?.({ reset: true }); }
  if (message === 'measure') {
    const elapsedMs = performance.now() - start, used = process.cpuUsage(cpu); const sorted = [...ticks].sort((a, b) => a - b);
    process.send?.({ elapsedMs, cpuOneCorePercent: (used.user + used.system) / (elapsedMs * 10), memory: process.memoryUsage(), ticks: ticks.length, tickMeanMs: ticks.reduce((a, b) => a + b, 0) / ticks.length, tickP50Ms: sorted[Math.floor(sorted.length * .5)], tickP95Ms: sorted[Math.floor(sorted.length * .95)], bytes, frames, disposed });
  }
  if (message === 'close') { await host.close(); process.disconnect(); }
});
