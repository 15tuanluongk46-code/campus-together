import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { Request, Response } from 'express';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { PROTOCOL_VERSION } from '@campus/shared';
import { CampusRoom } from './room.js';
import { readLimits, ServerOperations, type Limits } from './operations.js';
import { installHttpBoundary } from './http-boundary.js';
import { installUpgradeBoundary } from './origin-boundary.js';
import { createUnixOrigin, listenUnix, validateSocketDir } from './unix-origin.js';
export interface OriginOptions { cloudflareSocketDir?: string | undefined }
export async function createCampusServer(port = 2567, host = '127.0.0.1', limits: Partial<Limits> = {}, origin: OriginOptions = {}) {
  const socketPath = origin.cloudflareSocketDir === undefined ? undefined : await validateSocketDir(origin.cloudflareSocketDir);
  const operations = new ServerOperations({ ...readLimits(process.env), ...limits });
  const http = createServer();
  const unix = socketPath ? createUnixOrigin() : undefined;
  const server = new Server({
    transport: new WebSocketTransport({ server: http, maxPayload: 4096, perMessageDeflate: false }),
    greet: false, gracefullyShutdown: false,
    express: app => {
      app.get('/health', (_req: Request, res: Response) => res.json({ ok: true, protocol: PROTOCOL_VERSION }));
      app.get('/ready', (_req: Request, res: Response) => {
        const readiness = operations.readiness();
        res.set('Cache-Control', 'no-store').status(readiness.status === 'ready' ? 200 : 503).json(readiness);
      });
      // Identical relative location from src/ and dist/. Matchmaking/WS keep their original routes.
      const clientDist = fileURLToPath(new URL('../../client/dist/', import.meta.url));
      app.use(express.static(clientDist));
    },
  });
  // Constructor closure, never client options or process-global room ownership.
  class OwnedCampusRoom extends CampusRoom { constructor() { super(operations); } }
  server.define('campus', OwnedCampusRoom).on('create', (room: OwnedCampusRoom) => room.registered());
  server.onBeforeShutdown(async () => { operations.drain(); await operations.waitForInitialization(); });
  server.onShutdown(async () => { await unix?.close(); });
  // Pinned listen() binds its router before this synchronous listening callback;
  // no request can dispatch between binding and installing our outer boundary.
  let bindFailure: (error: Error) => void = () => {};
  try {
    // The pinned Server.listen attaches its error rejection too late for EADDRINUSE.
    await Promise.race([
      new Promise<never>((_resolve, reject) => { bindFailure = reject; http.once('error', bindFailure); }),
      server.listen(port, host, undefined, () => {
        if (unix) {
          for (const listener of http.listeners('request')) unix.http.on('request', listener as Parameters<typeof http.on>[1]);
          for (const listener of http.listeners('upgrade')) unix.http.on('upgrade', listener as Parameters<typeof http.on>[1]);
          installHttpBoundary(unix.http, server, operations, true);
          installUpgradeBoundary(unix.http, operations, true);
        }
        installHttpBoundary(http, server, operations);
        installUpgradeBoundary(http, operations);
      }),
    ]);
    if (unix && socketPath) await listenUnix(unix.http, socketPath);
  } catch (error) {
    operations.drain(); await server.gracefullyShutdown(false); await unix?.close();
    throw error;
  } finally { http.removeListener('error', bindFailure); }
  operations.started();
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('No TCP address');
  let closing: Promise<void> | undefined;
  return { server, http, socketPath, port: address.port, close: () => {
    operations.drain();
    return closing ??= server.gracefullyShutdown(false);
  } };
}
