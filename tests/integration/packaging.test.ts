import { afterEach, expect, it } from 'vitest';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
const root = process.cwd(), temporary: string[] = [];
afterEach(async () => { for (const dir of temporary.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function fixture() {
  await mkdir(resolve(root, 'artifacts'), { recursive: true });
  const dir = await mkdtemp(resolve(root, 'artifacts/packaging-test-')); temporary.push(dir);
  for (const path of ['package.json', 'package-lock.json', 'tsconfig.base.json', '.env.example', 'README.md', 'docs', 'deploy',
    'packages/shared/package.json', 'packages/shared/tsconfig.json', 'packages/shared/src',
    'apps/server/package.json', 'apps/server/tsconfig.json', 'apps/server/src',
    'apps/client/package.json', 'apps/client/tsconfig.json', 'apps/client/vite.config.ts', 'apps/client/index.html', 'apps/client/src', 'apps/client/public']) {
    await mkdir(resolve(dir, path, '..'), { recursive: true }); await cp(resolve(root, path), resolve(dir, path), { recursive: true });
  }
  for (const name of ['apps/client', 'apps/server', 'packages/shared']) {
    await mkdir(resolve(dir, name, 'dist'), { recursive: true });
    await writeFile(resolve(dir, name, 'dist/stale.txt'), `STALE ${name}`);
  }
  await writeFile(resolve(dir, 'apps/client/dist/index.html'), 'OLD CLIENT WITHOUT SOLO');
  return dir;
}
it('direct packaging ignores stale restored client/server dist, builds a fresh pair, preserves checkout, retains immutable archives', async () => {
  const dir = await fixture();
  const result = await run(process.execPath, [resolve(root, 'tools/package.mjs')], { cwd: dir, timeout: 150000, maxBuffer: 4 * 1024 * 1024 });
  const extraction = resolve(dir, 'extracted'); await mkdir(extraction);
  const latest = resolve(dir, 'artifacts/campus-together-0.1.0.tar.gz');
  await run('tar', ['-xzf', latest, '-C', extraction]);
  expect(await readFile(resolve(extraction, 'apps/client/dist/index.html'), 'utf8')).not.toContain('OLD CLIENT WITHOUT SOLO');
  for (const name of ['apps/client', 'apps/server', 'packages/shared']) expect(await readdir(resolve(extraction, name, 'dist'))).not.toContain('stale.txt');
  expect(await readFile(resolve(dir, 'apps/client/dist/index.html'), 'utf8')).toBe('OLD CLIENT WITHOUT SOLO');
  expect(await readFile(resolve(dir, 'apps/server/dist/stale.txt'), 'utf8')).toBe('STALE apps/server');
  const manifest = JSON.parse(await readFile(resolve(extraction, 'runtime-manifest.json'), 'utf8'));
  expect(manifest.build).toBe('clean-source-staging');
  expect(manifest.inputsSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(manifest.trees.map((t: { path: string }) => t.path)).toEqual(['packages/shared/dist', 'apps/server/dist', 'apps/client/dist']);
  const { createHash } = await import('node:crypto');
  const bytes = await readFile(latest), hash = createHash('sha256').update(bytes).digest('hex');
  expect(await readFile(resolve(dir, `artifacts/sha256/${hash}.tar.gz`))).toEqual(bytes);
  expect(result.stdout).toContain(hash);
  await run(process.execPath, ['tools/verify-runtime.mjs'], { cwd: extraction });
  await writeFile(resolve(extraction, 'apps/client/dist/index.html'), 'REPLACED CLIENT');
  await expect(run(process.execPath, ['tools/verify-runtime.mjs'], { cwd: extraction })).rejects.toThrow(/integrity mismatch/);
  // A later failed build must neither publish a mixed pair nor replace the last good archive.
  await writeFile(resolve(dir, 'apps/client/src/broken.ts'), 'export const broken: string = 42;');
  await expect(run(process.execPath, [resolve(root, 'tools/package.mjs')], { cwd: dir, timeout: 150000, maxBuffer: 4 * 1024 * 1024 })).rejects.toThrow();
  expect(await readFile(latest)).toEqual(bytes);
  expect(await readFile(resolve(dir, `artifacts/sha256/${hash}.tar.gz`))).toEqual(bytes);
  await rm(resolve(dir, 'apps/client/src/broken.ts'));
  await writeFile(resolve(dir, 'README.md'), 'Second coherent release');
  await run(process.execPath, [resolve(root, 'tools/package.mjs')], { cwd: dir, timeout: 150000, maxBuffer: 4 * 1024 * 1024 });
  expect(await readFile(latest)).not.toEqual(bytes);
  expect(await readFile(resolve(dir, `artifacts/sha256/${hash}.tar.gz`))).toEqual(bytes);
}, 300000);

it('failed clean source build cannot publish even when old dist looks packageable', async () => {
  const dir = await fixture(); await writeFile(resolve(dir, 'apps/server/src/broken.ts'), 'export const broken: string = 42;');
  let failed = false;
  try { await run(process.execPath, [resolve(root, 'tools/package.mjs')], { cwd: dir, timeout: 150000, maxBuffer: 4 * 1024 * 1024 }); } catch { failed = true; }
  expect(failed).toBe(true);
  expect(await readdir(resolve(dir, 'artifacts'))).not.toContain('campus-together-0.1.0.tar.gz');
  expect(await readFile(resolve(dir, 'apps/client/dist/index.html'), 'utf8')).toBe('OLD CLIENT WITHOUT SOLO');
}, 180000);

it('restore refuses unsealed or corrupted preservation before touching destination', async () => {
  const dir = await fixture(), backup = resolve(dir, '.superpowers/sdd/solo/pre-solo-runtime');
  await mkdir(resolve(backup, 'apps/client/dist'), { recursive: true });
  await writeFile(resolve(backup, 'apps/client/dist/index.html'), 'TAMPERED');
  await writeFile(resolve(backup, 'source.json'), JSON.stringify({ archive: 'historic-mutable-path', sha256: '0'.repeat(64) }));
  await expect(run(process.execPath, [resolve(root, 'tools/preserve-live-client.mjs'), 'restore', '--server-stopped'], { cwd: dir })).rejects.toThrow();
  expect(await readFile(resolve(dir, 'apps/client/dist/index.html'), 'utf8')).toBe('OLD CLIENT WITHOUT SOLO');
});

it('sealed preservation detects edits and clean restore excludes every stale merged asset', async () => {
  const dir = await fixture(), backup = resolve(dir, '.superpowers/sdd/solo/pre-solo-runtime');
  await mkdir(resolve(backup, 'apps/client/dist/assets'), { recursive: true });
  await writeFile(resolve(backup, 'apps/client/dist/index.html'), 'PRESERVED CLIENT');
  await writeFile(resolve(backup, 'apps/client/dist/assets/old.js'), 'old entry');
  await writeFile(resolve(backup, 'source.json'), JSON.stringify({ archive: 'artifacts/campus-together-0.1.0.tar.gz', sha256: '60d626a06990cb5b8e466ef518e9dbfa7c26d29bc38e185d7b2cc6c622f82fad' }));
  await run(process.execPath, [resolve(root, 'tools/preserve-live-client.mjs'), 'seal-historical'], { cwd: dir });
  const provenance = JSON.parse(await readFile(resolve(backup, 'source.json'), 'utf8'));
  expect(provenance.source.originalArchiveRetained).toBe(false);
  expect(provenance.source.historicalArchiveSha256).toBe('60d626a06990cb5b8e466ef518e9dbfa7c26d29bc38e185d7b2cc6c622f82fad');
  const restore = `const { restorePreservedClient } = await import(${JSON.stringify(resolve(root, 'tools/preserve-live-client.mjs'))}); await restorePreservedClient(process.cwd());`;
  await run(process.execPath, ['--input-type=module', '-e', restore], { cwd: dir });
  expect(await readdir(resolve(dir, 'apps/client/dist'))).toEqual(['assets', 'index.html']);
  expect(await readFile(resolve(dir, 'apps/client/dist/index.html'), 'utf8')).toBe('PRESERVED CLIENT');
  await writeFile(resolve(backup, 'apps/client/dist/assets/old.js'), 'tampered');
  await expect(run(process.execPath, ['--input-type=module', '-e', restore], { cwd: dir })).rejects.toThrow(/integrity mismatch/);
  expect(await readFile(resolve(dir, 'apps/client/dist/assets/old.js'), 'utf8')).toBe('old entry');
  // Migration is idempotent, never an automatic tamper re-baseline.
  await expect(run(process.execPath, [resolve(root, 'tools/preserve-live-client.mjs'), 'seal-historical'], { cwd: dir })).rejects.toThrow(/integrity mismatch/);
});
