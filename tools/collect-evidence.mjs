import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const base = resolve('.superpowers/sdd/campus');
const output = resolve(base, 'task4-review'); await mkdir(output, { recursive: true });
async function artifact(root, prefix, filename, destination) {
  const folder = (await readdir(resolve(base, root))).find(n => n.startsWith(prefix));
  if (!folder) throw new Error(`Missing ${root}/${prefix}`);
  await cp(resolve(base, root, folder, filename), resolve(output, destination));
}
for (const [source, target] of [['01-title.png', '01-title.png'], ['04-courtyard.png', '02-campus.png']]) await artifact('task4-final-browser', 'journey-', source, target);
for (const [source, target] of [['07-carry-crate.png', '03-carry.png'], ['10-classroom-clue.png', '04-classroom.png'], ['11-stage-ready.png', '05-stage.png'], ['12-festival-results.png', '06-final.png']]) await artifact('task4-final-browser', 'round-', source, target);
for (const name of ['south-boundary', 'storage-interior', 'classroom-corner']) {
  await artifact('task4-before', 'camera-', `${name}.png`, `before-${name}.png`);
  await artifact('task4-final-polish', 'camera-', `${name}.png`, `after-${name}.png`);
}
for (const name of ['campus-animation.webm', 'original-audio.webm', 'audio-signal.json']) await artifact('task4-final-browser', 'media-original-', name, name);
await artifact('task4-desktop-final', 'acceptance-', 'hardware-four-browser.json', 'hardware-four-browser.json');
await artifact('task4-final-polish', 'impairment-', 'browser-impairment.json', 'browser-impairment.json');
await artifact('task4-final-polish', 'art-', 'renderer-measurements.json', 'renderer-measurements.json');
await artifact('task4-final-polish', 'camera-', 'camera.json', 'camera.json');
await cp(resolve(base, 'task4-load/load.json'), resolve(output, 'server-load.json'));
const files = await readdir(output);
await writeFile(resolve(output, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Task 4 evidence</title><style>body{font:16px system-ui;background:#f6e7c9;color:#24473b;max-width:1200px;margin:auto;padding:24px}img,video{max-width:100%;height:auto}figure{margin:24px 0}</style><h1>Campus Together — Task 4 evidence</h1><p>Actual automated output. Human visual/audio sign-off and 60FPS target remain open. One browser + socket teammate in whole-round screenshots; hardware JSON documents four independent contexts.</p>${files.map(f => f.endsWith('.png') ? `<figure><figcaption>${f}</figcaption><img loading="lazy" src="${f}"></figure>` : f.endsWith('.webm') ? `<h2>${f}</h2>${f.includes('audio') ? `<audio controls src="${f}"></audio>` : `<video controls loop src="${f}"></video>`}` : `<p><a href="${f}">${f}</a></p>`).join('')}`);
console.log(JSON.stringify({ output, files: files.length }, null, 2));
