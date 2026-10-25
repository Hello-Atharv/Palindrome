// Build the WebAssembly module: web/wasm/lib/rvm_core.js. Works on Windows and macOS.
//   npm run build:wasm
// Needs the Emscripten SDK. Looks in $EMSDK, then ~/emsdk. Install once with:
//   git clone https://github.com/emscripten-core/emsdk.git ~/emsdk && cd ~/emsdk && ./emsdk install latest && ./emsdk activate latest
// (on Windows use emsdk.bat). The SDK lives outside the repo.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const emsdk = process.env.EMSDK || join(homedir(), 'emsdk');
const windows = process.platform === 'win32';

if (!existsSync(join(emsdk, windows ? 'emsdk_env.bat' : 'emsdk_env.sh'))) {
  console.error(`Emscripten SDK not found at ${emsdk}.\nInstall it (see the header of this script) or set EMSDK.`);
  process.exit(1);
}

// Capture the environment that emsdk_env sets up (PATH, EMSDK_NODE, EMSDK_PYTHON, ...).
const probe = windows
  ? spawnSync('cmd', ['/c', `"${join(emsdk, 'emsdk_env.bat')}" >nul 2>&1 && set`], { encoding: 'utf8', windowsVerbatimArguments: true })
  : spawnSync('bash', ['-c', `source "${join(emsdk, 'emsdk_env.sh')}" >/dev/null 2>&1 && env`], { encoding: 'utf8' });
if (probe.status !== 0) {
  console.error('Could not load the Emscripten environment:\n' + (probe.stderr || probe.stdout));
  process.exit(1);
}
const env = { ...process.env };
for (const line of probe.stdout.split(/\r?\n/)) {
  const eq = line.indexOf('=');
  if (eq > 0) env[line.slice(0, eq)] = line.slice(eq + 1);
}
env.EMSDK = emsdk;

function run(args) {
  const r = spawnSync('cmake', args, { cwd: root, env, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
run(['--preset', 'wasm']);
run(['--build', '--preset', 'wasm']);
console.log('\nBuilt web/wasm/lib/rvm_core.js');
