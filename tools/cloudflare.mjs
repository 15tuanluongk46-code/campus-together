import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { originReady, superviseChild, verifyIdentity } from './cloudflare-runtime.mjs';

// Foreground lifecycle: the controller/supervisor owns the process. No daemon,
// service install, account login, DNS change, or ambient cloudflared configuration.
const tools = dirname(fileURLToPath(import.meta.url));
const pin = JSON.parse(await readFile(join(tools, 'cloudflared-release.json'), 'utf8'));
const [action, directory, approval] = process.argv.slice(2);
if (!directory || !['prepare', 'validate', 'tunnel', 'status', 'stop'].includes(action)) {
  throw new Error('Usage: node tools/cloudflare.mjs prepare|validate|tunnel|status|stop ABS_PRIVATE_DIR [--activate-public]');
}
const dir = resolve(directory);
if (directory !== dir || await realpath(dir) !== dir) throw new Error('Use an absolute canonical directory without symlinks');
const stat = await lstat(dir);
if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o700) throw new Error('Directory must be user-owned mode 0700');
const socket = join(dir, 'origin.sock');
if (Buffer.byteLength(socket) > 103) throw new Error('Socket path exceeds 103 bytes');
const configPath = join(dir, 'cloudflared.json');
const statePath = join(dir, 'tunnel-process.json');
const binary = join(tools, 'bin', `cloudflared-${pin.version}`);
const config = { ingress: [{ service: `unix:${socket}` }] };

async function ownedFile(path) {
  const s = await lstat(path);
  if (!s.isFile() || s.uid !== process.getuid() || (s.mode & 0o077)) throw new Error('Unsafe operator file permissions');
}
async function binaryCheck() {
  const s = await lstat(binary);
  if (!s.isFile() || s.uid !== process.getuid() || (s.mode & 0o022)) throw new Error('Unsafe cloudflared binary');
  const digest = createHash('sha256').update(await readFile(binary)).digest('hex');
  if (digest !== pin.sha256) throw new Error('cloudflared checksum mismatch; executable was not run');
}
async function configCheck() {
  await ownedFile(configPath);
  if (JSON.stringify(JSON.parse(await readFile(configPath, 'utf8'))) !== JSON.stringify(config)) throw new Error('Ingress must contain only this game Unix socket');
}
async function tracked() {
  try { await ownedFile(statePath); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const saved = JSON.parse(await readFile(statePath, 'utf8'));
  if (!Number.isSafeInteger(saved.pid) || saved.pid < 2) throw new Error('Invalid process record');
  try { return await verifyIdentity(saved, binary, configPath); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
// An isolated HOME plus explicit config and allowlisted env avoids consuming
// account credentials, TUNNEL_URL, tokens, proxies or Node injection variables.
const env = { HOME: dir, PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' };
if (action === 'prepare') {
  try { await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; await configCheck(); }
  console.log(JSON.stringify({ configPath, socket, publicTunnelStarted: false }));
} else if (action === 'status') {
  const live = await tracked();
  console.log(JSON.stringify({ running: !!live, pid: live?.pid ?? null, configPath, socket }));
} else if (action === 'stop') {
  const live = await tracked();
  if (live) process.kill(live.pid, 'SIGTERM');
  console.log(JSON.stringify({ stopRequested: !!live, pid: live?.pid ?? null }));
} else {
  if (action === 'tunnel' && approval !== '--activate-public') throw new Error('Controller activation requires --activate-public');
  await binaryCheck(); await configCheck();
  execFileSync(binary, ['tunnel', '--config', configPath, 'ingress', 'validate'], { env, stdio: 'inherit' });
  if (action === 'tunnel') {
    if (await tracked()) throw new Error('Tunnel already running');
    const s = await lstat(socket);
    if (!s.isSocket() || s.uid !== process.getuid() || (s.mode & 0o777) !== 0o600) throw new Error('Origin must be user-owned socket 0600');
    await originReady(socket);
    // Lock before spawn: competing/stale operators must fail before any public
    // provisioning. An interrupted empty record needs explicit operator review.
    // URL is ONLY the QuickTunnel entrypoint switch in 2026.10.0. Validated
    // config ingress takes precedence in ParseIngressFromConfigAndCLI.
    // Port 1 is deliberately unusable, never the default TCP origin or CDP.
    const result = await superviseChild(binary, ['tunnel', '--config', configPath, '--no-autoupdate',
      '--metrics', '127.0.0.1:0', '--management-diagnostics=false', '--disable-path-normalization=false',
      '--url', 'http://127.0.0.1:1'], env, statePath);
    process.exitCode = result.code ?? (result.signal === 'SIGTERM' ? 0 : 1);
  }
}
