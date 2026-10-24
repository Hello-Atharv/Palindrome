/** Dev entry: the visualiser on the mock VM. Swap `createMockVm` for the WASM factory later; nothing else changes. */
import { createMockVm, ProgramBuilder, SAMPLES } from '../../mock_vm/src/index';
import { mountViz } from './index';

const vm = await createMockVm('logging');
const viz = mountViz(document.getElementById('app')!, vm, {
  programs: SAMPLES.map((s) => ({ name: s.name, blurb: s.blurb, load: () => s.build().image })),
});

// handles for scripts/screenshots.mjs and for poking at the app from the console (dev server only)
if (import.meta.env.DEV) Object.assign(window, { __dev: { viz, ProgramBuilder, samples: SAMPLES } });
