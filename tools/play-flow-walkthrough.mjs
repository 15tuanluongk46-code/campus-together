// Test-owned rendered-UI-only interactive driver. No gameplay modules, sockets,
// coordinates, snapshots or route planners are read. Input is normal Playwright input.
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
const output = '.superpowers/sdd/play-flow/discovery';
await mkdir(output, { recursive: true });
const child = spawn(process.execPath, ['apps/server/dist/index.js'], { env: { ...process.env, HOST: '127.0.0.1', PORT: '2767' }, stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 100; i++) { try { if ((await fetch('http://127.0.0.1:2767/health')).ok) break; } catch {} await sleep(100); }
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, args: ['--use-gl=angle', '--use-angle=gl'] });
const context = await browser.newContext({ viewport: { width: 1100, height: 720 } });
const page = await context.newPage(), errors = [], actions = [];
try { const previous = JSON.parse(await readFile(`${output}/actions.json`, 'utf8')); actions.push(...previous.actions); errors.push(...previous.errors); } catch {}
page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://127.0.0.1:2767'); await page.waitForLoadState('networkidle');
const server = createServer(async (req, res) => {
  try {
    let body = ''; for await (const chunk of req) body += chunk;
    const a = JSON.parse(body || '{}'); const entry = { time: new Date().toISOString(), ...a }; actions.push(entry);
    if (a.fill) await page.getByLabel(a.fill, { exact: true }).fill(a.value);
    if (a.click) await page.getByRole('button', { name: a.click, exact: true }).click();
    if (a.select) await page.getByLabel(a.select).selectOption(a.value);
    if (a.key) await page.keyboard.press(a.key, { delay: a.ms ?? 100 });
    if (a.mouse) await page.mouse.move(a.mouse[0], a.mouse[1]);
    if (a.wait) await sleep(a.wait);
    if (a.shot) await page.screenshot({ path: `${output}/${a.shot}.png` });
    const text = await page.locator('body').innerText();
    entry.renderedText = text;
    await writeFile(`${output}/actions.json`, JSON.stringify({ actions, errors }, null, 2));
    res.end(JSON.stringify({ text, errors }));
    if (a.close) { server.close(); await browser.close(); child.kill('SIGTERM'); }
  } catch (e) { res.statusCode = 500; res.end(String(e)); }
});
server.listen(2779, '127.0.0.1');
