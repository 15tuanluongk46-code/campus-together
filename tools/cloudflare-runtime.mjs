import { spawn } from 'node:child_process';
import { open, readFile, realpath, rm } from 'node:fs/promises';
import { request } from 'node:http';

export async function identity(pid) {
  const text = await readFile(`/proc/${pid}/stat`, 'utf8');
  const start = text.slice(text.lastIndexOf(')') + 2).split(' ')[19];
  return { pid, start, exe: await realpath(`/proc/${pid}/exe`) };
}

export async function verifyIdentity(saved, binary, configPath) {
  const live = await identity(saved.pid);
  if (live.start !== saved.start || live.exe !== await realpath(binary) || live.exe !== saved.exe) throw new Error('Refusing mismatched PID identity');
  const args = (await readFile(`/proc/${saved.pid}/cmdline`, 'utf8')).split('\0');
  if (!args.includes(configPath) || !args.includes('--no-autoupdate')) throw new Error('Refusing unrelated process');
  return live;
}

export function originReady(socket) {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath: socket, path: '/ready', headers: { 'cf-connecting-ip': '127.0.0.1' }, timeout: 2000 }, res => {
      let body = ''; res.on('data', b => { body += b; }); res.on('end', () => {
        try {
          const r = JSON.parse(body);
          if (res.statusCode !== 200 || r.status !== 'ready' || !Number.isSafeInteger(r.capacity) || r.capacity < 1) {
            throw new Error('Game origin is not ready with a positive safe integer capacity');
          }
          resolve();
        } catch (error) { reject(error); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Origin readiness timeout')));
    req.on('error', reject); req.end();
  });
}

/** Own the exclusive record and foreground child for one operator invocation. */
export async function superviseChild(binary, args, env, statePath) {
  const recordFile = await open(statePath, 'wx', 0o600);
  let child, done;
  const forward = () => child?.kill('SIGTERM');
  try {
    child = spawn(binary, args, { env, stdio: 'inherit' });
    // Always fulfilled: an error must not become an unhandled rejection while
    // identity/file I/O is pending, or abort finally on a second await.
    done = new Promise(resolve => {
      let error;
      child.once('error', cause => { error = cause; });
      child.once('close', (code, signal) => resolve({ code, signal, error }));
    });
    const spawned = await new Promise(resolve => {
      child.once('spawn', () => resolve({}));
      child.once('error', error => resolve({ error }));
    });
    if (spawned.error) throw spawned.error;
    process.once('SIGINT', forward); process.once('SIGTERM', forward);
    const record = await identity(child.pid);
    await recordFile.writeFile(`${JSON.stringify(record)}\n`);
    await recordFile.close();
    const result = await done;
    if (result.error) throw result.error;
    return result;
  } finally {
    process.removeListener('SIGINT', forward); process.removeListener('SIGTERM', forward);
    try {
      if (child?.pid && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      await done;
    } finally {
      try { await recordFile.close(); }
      finally { await rm(statePath, { force: true }); }
    }
  }
}
