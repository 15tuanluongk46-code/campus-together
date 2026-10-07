import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { isIP } from 'node:net';
import { matchMaker, ServerError } from '@colyseus/core';
import { canonicalPeer, type ServerOperations } from './operations.js';

const forwarding = new Set(['cf-connecting-ip', 'cf-connecting-ipv6', 'cf-pseudo-ipv4', 'true-client-ip',
  'x-forwarded-for', 'x-real-ip', 'x-client-ip', 'forwarded', 'x-forwarded-proto']);

/** Trust is a listener-owned capability, never an HTTP header or loopback address. */
export function originPeer(req: IncomingMessage, cloudflare: boolean): string {
  let peer = req.socket.remoteAddress ?? '';
  if (cloudflare) {
    const value = req.headers['cf-connecting-ip'];
    let count = 0;
    for (let i = 0; i < req.rawHeaders.length; i += 2) if (req.rawHeaders[i]!.toLowerCase() === 'cf-connecting-ip') count++;
    if (count !== 1 || typeof value !== 'string' || value.includes('%') || !isIP(value)) {
      throw new ServerError(400, 'Không xác định được kết nối Cloudflare. Hãy thử lại.');
    }
    peer = canonicalPeer(value);
  }
  for (const header of forwarding) delete req.headers[header];
  req.rawHeaders = req.rawHeaders.flatMap((value, i, all) => i % 2 === 0 && !forwarding.has(value.toLowerCase()) ? [value, all[i + 1]!] : []);
  // Pinned Colyseus createAuthContext reads x-real-ip. Only synthesize it AFTER
  // stripping untrusted input, on the Unix channel, for room HTTP/WS auth context.
  if (cloudflare) req.headers['x-real-ip'] = peer;
  return peer;
}

export function gamePath(req: IncomingMessage): string {
  const raw = (req.url ?? '/').split('?')[0]!;
  let path: string;
  try { path = decodeURIComponent(raw); } catch { throw new ServerError(404, 'Không tìm thấy.'); }
  if (!path.startsWith('/') || path.includes('\\') || path.includes('//') || path.includes('\0') ||
      path.split('/').some(part => part === '.' || part === '..' || part.startsWith('.'))) {
    throw new ServerError(404, 'Không tìm thấy.');
  }
  return path;
}

export function allowGameHttp(req: IncomingMessage): void {
  const path = gamePath(req);
  const read = req.method === 'GET' || req.method === 'HEAD';
  if (read && (['/', '/index.html', '/favicon.svg', '/health', '/ready'].includes(path) || path.startsWith('/assets/'))) return;
  if (req.method === 'POST' || req.method === 'OPTIONS') {
    if (/^\/matchmake\/(create|joinOrCreate|join)\/campus\/?$/.test(path) ||
        /^\/matchmake\/(joinById|reconnect)\/[a-zA-Z0-9_-]+\/?$/.test(path)) return;
  }
  throw new ServerError(404, 'Không tìm thấy.');
}

/** Wrap upgrades BEFORE the framework handshake/auth path, on both listeners. */
export function installUpgradeBoundary(http: HttpServer, ops: ServerOperations, cloudflare = false): void {
  const dispatch = http.listeners('upgrade') as ((req: IncomingMessage, socket: Duplex, head: Buffer) => void)[];
  http.removeAllListeners('upgrade');
  http.on('upgrade', (req, socket, head) => {
    try {
      originPeer(req, cloudflare);
      ops.assertAccepting();
      if (cloudflare) {
        const parts = /^\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)$/.exec(gamePath(req));
        if (!parts || parts[1] !== matchMaker.processId || !matchMaker.getLocalRoomById(parts[2]!)) throw new ServerError(404, 'Không tìm thấy.');
      }
      for (const listener of dispatch) listener.call(http, req, socket, head);
    } catch (error) {
      const code = error instanceof ServerError ? error.code : 400;
      socket.on('error', () => socket.destroy());
      socket.end(`HTTP/1.1 ${code} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    }
  });
}
