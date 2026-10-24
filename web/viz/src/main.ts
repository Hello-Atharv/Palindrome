/** Dev entry: the visualiser on the mock VM. Swap `createMockVm` for the WASM factory later; nothing else changes. */
import { createMockVm, SAMPLES } from '../../mock_vm/src/index';
import { mountViz } from './index';

const vm = await createMockVm('logging');
mountViz(document.getElementById('app')!, vm, {
  programs: SAMPLES.map((s) => ({ name: s.name, blurb: s.blurb, load: () => s.build().image })),
});
