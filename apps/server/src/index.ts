import { createCampusServer } from './server.js';

const port = Number(process.env.PORT ?? 2567);
const host = process.env.HOST ?? '127.0.0.1';
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT phải là số nguyên 1–65535.');
const app = await createCampusServer(port, host, {}, { cloudflareSocketDir: process.env.CAMPUS_CLOUDFLARE_SOCKET_DIR });
console.log(`Campus Together: http://${host}:${app.port} (WebSocket cùng cổng)`);
if (app.socketPath) console.log(`Cloudflare origin: unix:${app.socketPath}`);
let closing = false;
const shutdown = async () => {
  if (closing) return; closing = true;
  try { await app.close(); }
  catch (error) { console.error('Campus shutdown failed', error); process.exitCode = 1; }
};
process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });
