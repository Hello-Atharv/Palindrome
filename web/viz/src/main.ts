/**
 * Dev entry. Engines: the real C++ VMs in WebAssembly (web/wasm) when the module loads, else the mock logging VM.
 * Programs: the demo programs assembled in the browser (asm/src/index.ts), plus a hand-built framebuffer sample.
 * This is the only file that knows about web/mock_vm, web/wasm and asm/.
 */
import { assemble } from '../../../asm/src/index';
import cipher from '../../../programs/cipher.s?raw';
import sort from '../../../programs/sort.s?raw';
import call from '../../../asm/examples/call.s?raw';
import ifelse from '../../../asm/examples/ifelse_macro.s?raw';
import loop from '../../../asm/examples/loop_macro.s?raw';
import memory from '../../../asm/examples/memory.s?raw';
import nested from '../../../asm/examples/nested.s?raw';
import type { CreateVm, RVM, VmKind } from '../../../spec/vm_api';
import { createMockVm, gradient } from '../../mock_vm/src/index';
import { createWasmVm } from '../../wasm/src/index';
import type { AssembleFn } from './assembler';
import { formatDiagnostics } from './assembler';
import { ADD_TWO_NUMBERS } from './examples';
import { mountViz } from './index';
import type { ProgramEntry } from './program';

const assembleHook: AssembleFn = (source, fileName = 'edited.s') => {
  const r = assemble(source, { fileName });
  return { ok: r.ok, image: r.image, diagnostics: r.diagnostics, listing: r.listing };
};

/** An entry assembled from source; assembly errors become the message shown to the user. */
const fromSource = (name: string, blurb: string, source: string): ProgramEntry => ({
  name,
  blurb,
  source,
  load: () => {
    const r = assembleHook(source, `${name}.s`);
    if (!r.ok || !r.image) throw new Error(formatDiagnostics(name, r.diagnostics));
    return r.image;
  },
});

/** Simple programs first: they open in the Visualisation tab. Sort, cipher and the gradient are too big to animate. */
const programs: ProgramEntry[] = [
  fromSource('if / else', '.if / .else / .fi macros: watch the data move through the datapath', ifelse),
  fromSource('add two numbers', 'send two numbers, the machine adds them and files the sum (reversible)', ADD_TWO_NUMBERS),
  fromSource('loop', '.loop / .again macros', loop),
  fromSource('nested loop', 'a loop with an if inside', nested),
  fromSource('call / return', 'CALL, PROC and RET on the stack', call),
  fromSource('memory', 'data, framebuffer, neg', memory),
  fromSource('sort', 'a reversible sort that exposes its garbage: 19 hatched words at data address 8', sort),
  fromSource('cipher', 'Speck64/128: encrypt, then flip Reverse (direction -1) and the same program decrypts', cipher),
  { name: 'gradient', blurb: 'fills the framebuffer in a loop (hand-built image)', load: () => gradient().image },
];

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

const viz = mountViz(document.getElementById('app')!, first, { programs, createVm, engines, assemble: assembleHook });

// handles for scripts/screenshots.mjs and for poking at the app from the console (dev server only)
if (import.meta.env.DEV) Object.assign(window, { __dev: { viz, programs } });
