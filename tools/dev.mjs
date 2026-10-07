import { spawn } from 'node:child_process';
const children = [spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'apps/client', '--host', '0.0.0.0'], { stdio: 'inherit' }), spawn(process.execPath, ['--import', 'tsx', '--watch', 'apps/server/src/index.ts'], { stdio: 'inherit' })];
let closing = false;
function close(code = 0) { if (closing) return; closing = true; for (const child of children) child.kill('SIGTERM'); process.exitCode = code; }
for (const child of children) child.on('exit', code => close(code ?? 0));
process.on('SIGINT', () => close()); process.on('SIGTERM', () => close());
