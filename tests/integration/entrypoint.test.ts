import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { expect, it } from 'vitest';
import { sleep } from '../helpers/client.js';

it('compiled standalone entrypoint serves health on loopback and exits cleanly on SIGTERM', async () => {
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const address = reservation.address();
  if (!address || typeof address === 'string') throw new Error('Missing ephemeral port');
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  const child = spawn(process.execPath, ['apps/server/dist/index.js'], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(address.port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', data => { output += String(data); }); child.stderr.on('data', data => { output += String(data); });
  const exited = once(child, 'exit');
  try {
    let response: Response | undefined;
    for (let i = 0; i < 60; i++) {
      response = await fetch(`http://127.0.0.1:${address.port}/health`).catch(() => undefined);
      if (response) break;
      await sleep(50);
    }
    expect(response, output).toBeDefined();
    expect(await response!.json()).toEqual({ ok: true, protocol: 1 });
    child.kill('SIGTERM');
    expect(await exited).toEqual([0, null]);
    expect(output).toContain(`127.0.0.1:${address.port}`);
  } finally { if (child.exitCode === null) child.kill('SIGKILL'); }
});
