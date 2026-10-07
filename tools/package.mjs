import { cp, mkdir, mkdtemp, readFile, rm, writeFile, rename } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256, treeIntegrity, verifyRuntime } from './runtime-integrity.mjs';

const root = process.cwd(), tools = dirname(fileURLToPath(import.meta.url));
const output = resolve(root, 'artifacts'); await mkdir(output, { recursive: true });
const staging = await mkdtemp(resolve(output, 'package-'));
const source = resolve(staging, 'source'), runtime = resolve(staging, 'runtime');
const inputs = ['package.json', 'package-lock.json', 'tsconfig.base.json', '.env.example', 'README.md', 'docs', 'deploy',
  'packages/shared/package.json', 'packages/shared/tsconfig.json', 'packages/shared/src',
  'apps/server/package.json', 'apps/server/tsconfig.json', 'apps/server/src',
  'apps/client/package.json', 'apps/client/tsconfig.json', 'apps/client/vite.config.ts', 'apps/client/index.html', 'apps/client/src', 'apps/client/public'];
async function copy(from, to, paths) {
  for (const path of paths) { await mkdir(resolve(to, path, '..'), { recursive: true }); await cp(resolve(from, path), resolve(to, path), { recursive: true }); }
}
async function retain(bytes) {
  const hash = sha256(bytes), path = resolve(output, 'sha256', `${hash}.tar.gz`);
  await mkdir(dirname(path), { recursive: true });
  try { await writeFile(path, bytes, { flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; if (sha256(await readFile(path)) !== hash) throw new Error(`Corrupted retained archive: ${path}`); }
  await writeFile(`${path}.sha256`, `${hash}  ${hash}.tar.gz\n`);
  return { hash, path };
}
try {
  // Never consume checkout dist or tsbuildinfo, and never build into the live checkout.
  await copy(root, source, inputs);
  await copy(tools, resolve(source, 'tools'), ['runtime-integrity.mjs', 'verify-runtime.mjs', 'cloudflare.mjs', 'cloudflare-runtime.mjs', 'cloudflared-release.json']);
  const inputTree = await treeIntegrity(source);
  const env = { ...process.env };
  // This runtime is a coherent same-origin deployment, independent of a shell's dev override.
  delete env.VITE_SERVER_URL;
  execFileSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: source, env, stdio: 'inherit' });
  execFileSync('npm', ['run', 'build'], { cwd: source, env, stdio: 'inherit' });
  await copy(source, runtime, ['package.json', 'package-lock.json', '.env.example', 'README.md', 'docs', 'deploy',
    'packages/shared/package.json', 'packages/shared/dist', 'apps/server/package.json', 'apps/server/dist', 'apps/client/package.json', 'apps/client/dist']);
  await copy(source, runtime, ['tools']);
  const trees = [];
  for (const path of ['packages/shared/dist', 'apps/server/dist', 'apps/client/dist']) trees.push({ path, ...(await treeIntegrity(resolve(runtime, path))) });
  const manifest = { version: 1, build: 'clean-source-staging', inputsSha256: inputTree.sha256, node: process.version, trees, runtime: await treeIntegrity(runtime) };
  await writeFile(resolve(runtime, 'runtime-manifest.json'), JSON.stringify(manifest, null, 2));
  await verifyRuntime(runtime);
  const packed = resolve(staging, 'runtime.tar.gz');
  execFileSync('tar', ['--sort=name', '--mtime=UTC 2026-10-05', '--owner=0', '--group=0', '--numeric-owner', '-czf', packed, '-C', runtime, '.']);
  const bytes = await readFile(packed), retained = await retain(bytes);
  const archive = resolve(output, 'campus-together-0.1.0.tar.gz');
  // Keep any previous convenience artifact by its own actual hash before replacing it.
  try { await retain(await readFile(archive)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await rename(packed, archive);
  const checksum = resolve(staging, 'checksum'); await writeFile(checksum, `${retained.hash}  campus-together-0.1.0.tar.gz\n`); await rename(checksum, `${archive}.sha256`);
  console.log(JSON.stringify({ archive, retainedArchive: retained.path, bytes: bytes.length, sha256: retained.hash, inputsSha256: inputTree.sha256, runtimeSha256: manifest.runtime.sha256, install: 'node tools/verify-runtime.mjs && npm ci --omit=dev && npm start' }, null, 2));
} finally { await rm(staging, { recursive: true, force: true }); }
