/**
 * Dev entry. Engines: the real C++ VMs in WebAssembly (web/wasm) when the module loads, else the mock logging VM.
 * Programs: see catalogue.ts. This is the only file that knows about web/mock_vm and web/wasm.
 */
import type { CreateVm, RVM, VmKind } from '../../../spec/vm_api';
import { createMockVm } from '../../mock_vm/src/index';
import { createWasmVm } from '../../wasm/src/index';
import { assembleHook, compileHook, programs } from './catalogue';
import { mountViz } from './index';

let createVm: CreateVm = createMockVm;
let engines: VmKind[] = ['logging'];
let first: RVM;
try {
  first = await createWasmVm('logging'); // loads the WebAssembly module once; fails here if it is unavailable
  createVm = createWasmVm;
  engines = ['logging', 'reversible'];
} catch (e) {
  console.warn('WebAssembly engines unavailable, falling back to the mock logging VM:', e);
  first = await createMockVm('logging');
}

const viz = mountViz(document.getElementById('app')!, first, { programs, createVm, engines, assemble: assembleHook, compile: compileHook });

// handles for scripts/screenshots.mjs and for poking at the app from the console (dev server only)
if (import.meta.env.DEV) Object.assign(window, { __dev: { viz, programs } });
