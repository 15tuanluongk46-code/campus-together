import { createServer, type Server } from 'node:http';
import { chmod, lstat, realpath } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { Socket } from 'node:net';

/** No directory creation, chmod of caller files, or stale-socket deletion. */
export async function validateSocketDir(dir: string): Promise<string> {
  if (!isAbsolute(dir) || await realpath(dir) !== dir) throw new Error('Socket directory must be an absolute canonical path, without symlinks');
  const stat = await lstat(dir);
  if (!stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o700) {
    throw new Error('Socket directory must be owned by this user with mode 0700');
  }
  const path = join(dir, 'origin.sock');
  if (Buffer.byteLength(path) > 103) throw new Error('Unix socket path is too long (maximum 103 bytes)');
  try { await lstat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return path; throw error; }
  throw new Error('Origin socket path already exists; stop its owner or review stale state first');
}

export function createUnixOrigin() {
  const http = createServer();
  const sockets = new Set<Socket>();
  http.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  let closing: Promise<void> | undefined;
  return { http, close: () => closing ??= new Promise<void>((resolve, reject) => {
    http.close(error => error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve());
    // Includes upgraded connections and partial HTTP requests. Rooms have already
    // drained through Colyseus before normal shutdown reaches this cleanup.
    for (const socket of sockets) socket.destroy();
  }) };
}

export async function listenUnix(http: Server, path: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const fail = (error: Error) => reject(error);
    http.once('error', fail);
    http.listen(path, () => { http.removeListener('error', fail); resolve(); });
  });
  // The containing directory is already 0700 while bind -> chmod completes.
  await chmod(path, 0o600);
}
