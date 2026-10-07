import { cp, mkdir, mkdtemp, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createConnection } from 'node:net';
import { treeIntegrity } from './runtime-integrity.mjs';

const historicalSha256 = '60d626a06990cb5b8e466ef518e9dbfa7c26d29bc38e185d7b2cc6c622f82fad';
const backupAt = root => resolve(root, '.superpowers/sdd/solo/pre-solo-runtime');

/** One-time migration: the old archive is gone; seal the bytes that actually remain. */
export async function sealHistoricalClient(root) {
  const backup = backupAt(root), path = resolve(backup, 'source.json');
  const old = JSON.parse(await readFile(path, 'utf8'));
  if (old.version === 2) { await verifyPreservedClient(root); return old; }
  if (old.sha256 !== historicalSha256) throw new Error('Unexpected historical provenance; refusing to reseal');
  const tree = await treeIntegrity(resolve(backup, 'apps/client/dist'));
  const provenance = {
    version: 2,
    source: { kind: 'historical-archive-extraction', historicalArchivePath: old.archive, historicalArchiveSha256: old.sha256,
      originalArchiveRetained: false, note: 'Path is a historical locator, NOT a reference to its current contents. Original archive was overwritten before this migration.' },
    preservedTree: { ...tree, sealedAt: new Date().toISOString(), assurance: 'Integrity baseline of surviving extracted bytes at migration; not a retrospective re-verification against the lost original archive.' },
  };
  await writeFile(`${path}.next`, JSON.stringify(provenance, null, 2)); await rename(`${path}.next`, path);
  return provenance;
}
export async function verifyPreservedClient(root) {
  const backup = backupAt(root), provenance = JSON.parse(await readFile(resolve(backup, 'source.json'), 'utf8'));
  if (provenance.version !== 2 || provenance.preservedTree?.algorithm !== 'sha256-path-content-v1') throw new Error('Preserved client is not integrity-sealed; use seal-historical once for the documented legacy extraction');
  const tree = await treeIntegrity(resolve(backup, 'apps/client/dist'));
  if (tree.sha256 !== provenance.preservedTree.sha256) throw new Error('Preserved client integrity mismatch; refusing restore');
  return tree;
}
/** Offline filesystem operation. CLI separately refuses while :2567 accepts connections. */
export async function restorePreservedClient(root) {
  const expected = await verifyPreservedClient(root);
  const parent = resolve(root, 'apps/client'), destination = resolve(parent, 'dist');
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(resolve(parent, '.restore-'));
  const clean = resolve(staging, 'clean'), previous = resolve(staging, 'previous');
  let moved = false, installed = false;
  try {
    await cp(resolve(backupAt(root), 'apps/client/dist'), clean, { recursive: true });
    if ((await treeIntegrity(clean)).sha256 !== expected.sha256) throw new Error('Preserved tree changed while staging');
    try { await rename(destination, previous); moved = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await rename(clean, destination); installed = true;
    if ((await treeIntegrity(destination)).sha256 !== expected.sha256) throw new Error('Restored tree integrity mismatch');
    return expected;
  } catch (error) {
    if (installed) await rm(destination, { recursive: true, force: true });
    if (moved) await rename(previous, destination);
    throw error;
  } finally { await rm(staging, { recursive: true, force: true }); }
}
async function portIsOpen() {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port: 2567 });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', error => { socket.destroy(); if (error.code === 'ECONNREFUSED') resolve(false); else reject(error); });
    socket.setTimeout(1500, () => { socket.destroy(); reject(new Error('Cannot establish whether :2567 is stopped')); });
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = process.cwd(), action = process.argv[2];
  if (action === 'seal-historical') console.log(JSON.stringify(await sealHistoricalClient(root), null, 2));
  else if (action === 'verify') console.log(JSON.stringify({ verified: true, ...(await verifyPreservedClient(root)) }, null, 2));
  else if (action === 'restore') {
    await verifyPreservedClient(root);
    if (!process.argv.includes('--server-stopped') || await portIsOpen()) throw new Error('Clean restore is offline-only: controller must stop :2567 first and pass --server-stopped');
    console.log(JSON.stringify({ restored: true, ...(await restorePreservedClient(root)) }, null, 2));
  } else throw new Error('Use seal-historical | verify | restore --server-stopped. Packaging never needs restoration.');
}
