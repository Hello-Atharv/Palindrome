// Bundles the extension (and the compiler, assembler and WebAssembly engines it uses) into dist/ with esbuild.
// dist/core.js is the same logic without the vscode API, for testing the bundle in plain Node.
import { build } from 'esbuild';

// The Emscripten loader asks for import.meta.url; in a CommonJS bundle that is the bundle's own file URL.
const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  sourcemap: true,
  logLevel: 'info',
  define: { 'import.meta.url': '__importMetaUrl' },
  banner: { js: "const __importMetaUrl = require('url').pathToFileURL(__filename).href;" },
};
await build({ ...common, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js', external: ['vscode'] });
await build({ ...common, entryPoints: ['src/core.ts'], outfile: 'dist/core.js' });
