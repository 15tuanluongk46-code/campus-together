import { createServer, request } from 'node:http';
import { WebSocket, WebSocketServer, type RawData } from 'ws';

/** Test-only forwarding proxy. Delays actual WS frames in order, bounded memory and lifetime.
 * Dropping complete application messages models loss above TCP; disconnect models a broken TCP path.
 */
export async function impairmentProxy(port: number) {
  const http = createServer((req, res) => {
    const upstream = request({ hostname: '127.0.0.1', port, path: req.url, method: req.method, headers: req.headers }, response => {
      res.writeHead(response.statusCode ?? 502, response.headers); response.pipe(res);
    });
    upstream.setTimeout(5000, () => upstream.destroy());
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); }); req.pipe(upstream);
  });
  const ws = new WebSocketServer({ server: http, maxPayload: 65536 });
  const sockets = new Set<WebSocket>(); const timers = new Set<ReturnType<typeof setTimeout>>();
  const stats = { forwarded: 0, dropped: 0, maxQueued: 0, connections: 0 };
  let enabled = false, counter = 0;
  let cutNextApplication = false;
  ws.on('connection', (down, req) => {
    const up = new WebSocket(`ws://127.0.0.1:${port}${req.url}`); sockets.add(down); sockets.add(up); stats.connections++;
    let queue = 0, lastUp = 0, lastDown = 0;
    const forward = (target: WebSocket, data: RawData, binary: boolean, direction: 'up' | 'down') => {
      const payload = Buffer.from(data as Buffer); const application = payload[0] === 13;
      if (cutNextApplication && direction === 'up' && application) {
        cutNextApplication = false; stats.dropped++; down.terminate(); up.terminate(); return;
      }
      if (enabled && application && ++counter % 13 === 0) { stats.dropped++; return; }
      if (++queue > 128) { down.terminate(); up.terminate(); return; }
      stats.maxQueued = Math.max(stats.maxQueued, queue);
      const delay = enabled && application ? [40, 130, 65, 90, 160][counter % 5]! : 0;
      const at = Math.max(Date.now() + delay, direction === 'up' ? lastUp : lastDown);
      if (direction === 'up') lastUp = at; else lastDown = at;
      const timer = setTimeout(() => {
        timers.delete(timer); queue--;
        if (target.readyState === WebSocket.OPEN) { target.send(payload, { binary }); stats.forwarded++; }
      }, at - Date.now()); timers.add(timer);
    };
    // The browser can send only after server handshake, which comes after upstream open.
    down.on('message', (data, binary) => forward(up, data, binary, 'up'));
    up.on('message', (data, binary) => forward(down, data, binary, 'down'));
    const close = () => { sockets.delete(down); sockets.delete(up); if (down.readyState < 2) down.close(4010); if (up.readyState < 2) up.close(4010); };
    down.on('close', close); up.on('close', close); down.on('error', close); up.on('error', close);
  });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  const address = http.address(); if (!address || typeof address === 'string') throw new Error('No proxy port');
  return {
    endpoint: `ws://127.0.0.1:${address.port}`, stats,
    enable: (value: boolean) => { enabled = value; },
    cutNextApplication: () => { cutNextApplication = true; },
    disconnect: () => { for (const socket of sockets) socket.terminate(); },
    close: async () => { for (const timer of timers) clearTimeout(timer); timers.clear(); for (const socket of sockets) socket.terminate(); await new Promise<void>(resolve => ws.close(() => resolve())); await new Promise<void>(resolve => http.close(() => resolve())); },
  };
}
