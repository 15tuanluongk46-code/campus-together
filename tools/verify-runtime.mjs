import { resolve } from 'node:path';
import { verifyRuntime } from './runtime-integrity.mjs';
const manifest = await verifyRuntime(resolve(process.argv[2] ?? '.'));
console.log(JSON.stringify({ verified: true, build: manifest.build, inputsSha256: manifest.inputsSha256, runtimeSha256: manifest.runtime.sha256 }));
