// Bundles the command line tools into single files that run with plain `node` and need no node_modules at run time, so they work
// the same on Windows, Linux (including WSL) and macOS:
//   cli/dist/rvm.mjs    the `rvm` command (build, run, report, verify, debug)
//   cli/dist/rvmc.mjs   the `rvmc` compiler command
// Run with: npm run build:cli (from the repo root), which `npm run setup` does for you. The output is not committed.
import { build } from 'esbuild';

const common = {
  bundle: true,
  platform: 'node',
  format: 'esm', // the entry points use top-level await
  target: 'node18',
  sourcemap: true,
  logLevel: 'info',
  // bundled CommonJS dependencies still call require() for Node's own modules
  banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
};
await build({ ...common, entryPoints: ['src/rvm.ts'], outfile: 'dist/rvm.mjs' });
await build({ ...common, entryPoints: ['../lang/src/cli.ts'], outfile: 'dist/rvmc.mjs' });
