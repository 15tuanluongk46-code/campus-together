// Optional project verification: packaging must leave the existing :2567 client untouched.
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { sha256, treeIntegrity } from './runtime-integrity.mjs';

const treeBefore = await treeIntegrity('apps/client/dist');
const htmlHash = sha256(await (await fetch('http://127.0.0.1:2567/')).arrayBuffer().then(b => Buffer.from(b)));
const child = spawn(process.execPath, ['tools/package.mjs'], { stdio: ['ignore', 'pipe', 'pipe'] });
const logs = []; child.stdout.on('data', b => logs.push(String(b))); child.stderr.on('data', b => logs.push(String(b)));
let done = false, samples = 0; const violations = [];
const exited = new Promise(resolve => child.once('exit', code => { done = true; resolve(code); }));
while (!done) {
  try {
    const health = await fetch('http://127.0.0.1:2567/health', { signal: AbortSignal.timeout(1500) });
    const html = await fetch('http://127.0.0.1:2567/', { signal: AbortSignal.timeout(1500) });
    if (!health.ok || !html.ok || sha256(Buffer.from(await html.arrayBuffer())) !== htmlHash) violations.push('Live HTTP or HTML changed');
    samples++;
  } catch (error) { violations.push(String(error)); }
  await new Promise(resolve => setTimeout(resolve, 100));
}
const code = await exited, treeAfter = await treeIntegrity('apps/client/dist');
const report = { code, samples, violations, htmlHash, treeBefore: treeBefore.sha256, treeAfter: treeAfter.sha256,
  checksum: await readFile('artifacts/campus-together-0.1.0.tar.gz.sha256', 'utf8'), buildLog: logs.join('') };
await writeFile('.superpowers/sdd/solo/fix-package-live.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, buildLog: 'see fix-package-live.json' }, null, 2));
if (code !== 0 || violations.length || treeBefore.sha256 !== treeAfter.sha256) process.exitCode = 1;
