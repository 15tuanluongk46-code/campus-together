import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import type { Server } from '@colyseus/core';
import { matchMaker, ServerError, toNodeHandler } from '@colyseus/core';
import type { ServerOperations } from './operations.js';
import { allowGameHttp, originPeer } from './origin-boundary.js';

/** Install in listen's synchronous callback, after the pinned framework binds routes.
 * Express middleware cannot guard the framework's preceding request listener.
 * Use the actual router matcher (including path normalization), not a parallel regex.
 */
export function installHttpBoundary(http: HttpServer, server: Server, ops: ServerOperations, cloudflare = false): void {
  const dispatch = http.listeners('request') as ((req: IncomingMessage, res: ServerResponse) => void)[];
  // The pinned framework's outer listener calls next() without returning its
  // Promise. Await its exported Node adapter directly for matched routes so
  // allocation finally follows actual async dispatch, not listener return.
  const routerDispatch = toNodeHandler(server.router.handler);
  http.removeAllListeners('request');
  http.on('request', (req, res) => {
    const handle = async () => {
      const peer = originPeer(req, cloudflare);
      if (cloudflare) allowGameHttp(req);
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      const route = server.router.findRoute(req.method ?? 'GET', path);
      const allocating = route?.data.path === '/matchmake/:method/:roomName' &&
        ['create', 'joinOrCreate'].includes(route.params?.method ?? '');
      if (route && req.method !== 'OPTIONS') {
        const run = async () => { setCors(req, res); await routerDispatch(req, res); };
        if (allocating) await ops.allocation(peer, run);
        else await run();
      } else for (const listener of dispatch) listener.call(http, req, res);
    };
    void handle().catch(error => {
      req.resume(); // Drain refused bodies so keep-alive connections remain usable.
      if (res.writableEnded || res.destroyed) return;
      if (res.headersSent) { res.destroy(); return; }
      const code = error instanceof ServerError && [400, 404, 429, 503].includes(error.code) ? error.code : 400;
      // A failing configured CORS hook must not throw again from the error path
      // or fall back to a more permissive reflection policy.
      try { setCors(req, res); } catch { for (const key of res.getHeaderNames()) res.removeHeader(key); }
      res.writeHead(code, { 'content-type': 'application/json',
        ...(code === 429 || code === 503 ? { 'retry-after': String(Math.ceil(ops.limits.createRefillMs / 1000)) } : {}) });
      res.end(JSON.stringify({ code, error: error instanceof ServerError ? error.message : 'Yêu cầu không hợp lệ.' }));
    });
  });
}

/** Exactly the pinned framework's typed, configured policy; no broader fallback. */
function setCors(req: IncomingMessage, res: ServerResponse): void {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach(v => headers.append(key, v));
    else if (value !== undefined) headers.set(key, value);
  }
  const policy = { ...matchMaker.controller.DEFAULT_CORS_HEADERS, ...matchMaker.controller.getCorsHeaders(headers) };
  for (const [key, value] of Object.entries(policy)) res.setHeader(key, value);
}
