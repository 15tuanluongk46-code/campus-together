import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

export const sha256 = data => createHash('sha256').update(data).digest('hex');
/** Stable names + bytes; no symlinks or special files are accepted in runtime trees. */
export async function treeIntegrity(root, exclude = []) {
  const files = [];
  async function visit(relative) {
    for (const entry of (await readdir(resolve(root, relative), { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : 1)) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (exclude.includes(path)) continue;
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push({ path, sha256: sha256(await readFile(resolve(root, path))) });
      else throw new Error(`Unsupported runtime entry: ${path}`);
    }
  }
  await visit('');
  return { algorithm: 'sha256-path-content-v1', sha256: sha256(JSON.stringify(files)), files };
}
export async function verifyRuntime(root) {
  const manifest = JSON.parse(await readFile(resolve(root, 'runtime-manifest.json'), 'utf8'));
  if (manifest.build !== 'clean-source-staging') throw new Error('Missing clean build provenance');
  const actual = await treeIntegrity(root, ['runtime-manifest.json', 'node_modules']);
  if (actual.sha256 !== manifest.runtime.sha256) throw new Error('Runtime tree integrity mismatch');
  return manifest;
}
