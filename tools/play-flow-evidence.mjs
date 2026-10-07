// Post-process test artifacts only. No game or user-profile state is touched.
import { readdir, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
const root = '.superpowers/sdd/play-flow';
const output = join(root, 'controller-images'); await mkdir(output, { recursive: true });
const rows = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { if (!/report|controller-images/.test(entry.name)) await walk(path); }
    else if (entry.name.endsWith('.png')) {
      const name = path.slice(root.length + 1).replaceAll('/', '--').replace(/\.png$/, '.jpg');
      execFileSync('convert', [path, '-resize', '1000x', '-quality', '78', join(output, name)]);
      rows.push({ source: path, resized: join(output, name) });
    }
  }
}
await walk(root); await writeFile(join(output, 'index.json'), JSON.stringify(rows, null, 2));
console.log(JSON.stringify({ resized: rows.length, directory: output }));
