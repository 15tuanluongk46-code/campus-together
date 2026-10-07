// Summarize retained raw evidence without rewriting measurements.
import { readdir, readFile } from 'node:fs/promises';
const base = '.superpowers/sdd/campus/performance';
for (const dir of await readdir(base, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  let report: any; try { report = JSON.parse(await readFile(`${base}/${dir.name}/measurements.json`, 'utf8')); } catch { continue; }
  console.log(JSON.stringify({ label: dir.name, desktop: report.desktop, target60: report.target60, desktopAcceptance: report.desktopAcceptance, rows: report.samples.map((s: any) => ({ mode: s.scenario, fps: s.fps, window: s.windowMs, p95: s.raf.p95, cpu: s.probe?.cpu.mean, gpu: s.probe?.gpu.mean, calls: s.probe?.calls.mean, triangles: s.probe?.triangles.mean, ui: s.probe?.ui.mean, extra: s.extra?.map((e: any) => ({ fps: e.fps, p95: e.raf.p95 })), gpuRange: ['utilization', 'memoryMiB'].map((name, i) => ({ name, min: Math.min(...s.gpuSamples.map((r: string) => Number(r.split(',')[i ? 3 : 1]))), max: Math.max(...s.gpuSamples.map((r: string) => Number(r.split(',')[i ? 3 : 1]))) })) })) }));
}
