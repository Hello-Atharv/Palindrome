/**
 * Dev entry. Engines: the real C++ VMs in WebAssembly (web/wasm) when the module loads, else the mock logging VM.
 * Programs: the demo programs assembled in the browser (asm/src/index.ts), plus a hand-built framebuffer sample.
 * This is the only file that knows about web/mock_vm, web/wasm and asm/.
 */
import { assemble } from '../../../asm/src/index';
import { compile, formatDiagnostics as formatRevDiagnostics } from '../../../lang/src/compile';
import fib from '../../../examples/rev/fib.rev?raw';
import hello from '../../../examples/rev/hello.rev?raw';
import pongRev from '../../../examples/demos/pong.rev?raw';
import cipher from '../../../examples/demos/cipher.s?raw';
import pong from '../../../examples/demos/pong.s?raw';
import sort from '../../../examples/demos/sort.s?raw';
import sortRev from '../../../examples/rev/sort8.rev?raw';
import call from '../../../examples/asm/call.s?raw';
import ifelse from '../../../examples/asm/ifelse_macro.s?raw';
import loop from '../../../examples/asm/loop_macro.s?raw';
import memory from '../../../examples/asm/memory.s?raw';
import nested from '../../../examples/asm/nested.s?raw';
import type { CreateVm, RVM, VmKind } from '../../../spec/vm_api';
import { createMockVm, gradient } from '../../mock_vm/src/index';
import { createWasmVm } from '../../wasm/src/index';
import type { AssembleFn } from './assembler';
import { formatDiagnostics } from './assembler';
import { ADD_TWO_NUMBERS, BLANK_PROGRAM } from './examples';
import { mountViz } from './index';
import type { ProgramEntry } from './program';

const assembleHook: AssembleFn = (source, fileName = 'edited.s') => {
  const r = assemble(source, { fileName });
  return { ok: r.ok, image: r.image, diagnostics: r.diagnostics, listing: r.listing };
};

/**
 * The rev compiler in the shape of the assembler hook. Diagnostics and the listing are in terms of the rev source: the
 * compiler's line map takes each generated assembly line back to the rev line that produced it.
 */
const compileHook: AssembleFn = (source) => {
  const c = compile(source);
  const lines = source.split('\n');
  const diagnostics = [
    ...c.diagnostics.map((d) => ({ severity: 'error' as const, line: d.line, message: d.message })),
    ...c.warnings.map((d) => ({ severity: 'warning' as const, line: d.line, message: d.message })),
  ];
  const listing = (c.ok && c.assembled && c.lineMap ? c.assembled.listing : []).map((r) => {
    const line = c.lineMap![r.line - 1] ?? 0;
    return { addr: r.addr, word: r.word, line, text: lines[line - 1] ?? '' };
  });
  return { ok: c.ok, image: c.image, diagnostics, listing };
};

/** An entry compiled from rev source; compile errors become the message shown to the user. */
const fromRev = (name: string, blurb: string, source: string, game?: ProgramEntry['game'], speed?: number): ProgramEntry => ({
  name,
  blurb,
  source,
  language: 'rev',
  game,
  speed,
  load: () => {
    const c = compile(source);
    if (!c.ok || !c.image) throw new Error(formatRevDiagnostics(`${name}.rev`, c.diagnostics));
    return c.image;
  },
});

/** An entry assembled from source; assembly errors become the message shown to the user. */
const fromSource = (name: string, blurb: string, source: string, speed?: number): ProgramEntry => ({
  name,
  blurb,
  source,
  speed,
  load: () => {
    const r = assembleHook(source, `${name}.s`);
    if (!r.ok || !r.image) throw new Error(formatDiagnostics(name, r.diagnostics));
    return r.image;
  },
});

/** Simple programs first: they open in the Visualisation tab. Sort, cipher, Pong and the gradient are too big to animate. */
const programs: ProgramEntry[] = [
  fromSource('if / else', 'watch an if / else move data through the datapath', ifelse),
  fromSource('add two numbers', 'type two numbers; the machine adds and prints them', ADD_TWO_NUMBERS),
  fromSource('loop', 'a loop, written with the .loop macros', loop),
  fromSource('nested loop', 'an if inside a loop', nested),
  fromSource('call / return', 'a procedure call and return on the stack', call),
  fromSource('memory', 'loads, stores and the framebuffer', memory),
  fromSource('my program', 'a blank template for your own assembly (edits are saved in this browser)', BLANK_PROGRAM),
  fromSource('sort', 'a reversible sort; the 19 hatched words are what it cannot erase', sort),
  fromSource('cipher', 'Speck64/128: encrypt, then run it backwards to decrypt', cipher),
  {
    ...fromSource('pong', 'Pong: W / S or the arrow keys move the paddle', pong, 10_000),
    game: {
      blocks: true,
      log: { addr: 0x1000, bytesPerFrame: 8 },
      note:
        'Press Run, then use W / S or the arrow keys to move the cyan paddle. Return the ball and a yellow block lights up: that is your score. Miss it and the game halts. ' +
        'Back, Back one frame and the time bar rewind the game exactly, replaying your keys. The key log is the only garbage Pong keeps (8 bytes a frame). ' +
        'Direction -1 is not exact for programs that read input, so rewind with Back.',
    },
  },
  fromRev('pong (rev)', 'the same Pong in rev, with a wall and a numeric score', pongRev, {
    log: { addr: 0x1000, bytesPerFrame: 8 },
    note:
      'Press Run, then use W / S or the arrow keys. This is the same game in rev, with a grey wall and your score as a number. ' +
      'Back, Back one frame and the time bar rewind it exactly, score included. Edit the source and press Build and load.',
  }, 10_000),
  fromRev('sort (rev)', 'the same sorting network in rev: 36 lines instead of 340 (the list lives in data memory)', sortRev),
  fromRev('hello (rev)', 'prints text; step back and it un-prints', hello),
  fromRev('fibonacci (rev)', 'Fibonacci in rev; nothing is thrown away', fib),
  { name: 'gradient', blurb: 'fills the screen in a loop (hand-built image)', load: () => gradient().image },
];

/** A program that exists in assembly and in rev: the two are one entry in the picker, with a switch between them. */
function pair(asmName: string, revName: string): void {
  const i = programs.findIndex((p) => p.name === revName);
  const [rev] = programs.splice(i, 1);
  const asm = programs.find((p) => p.name === asmName)!;
  asm.alt = rev;
  rev.alt = asm;
}
pair('pong', 'pong (rev)');
pair('sort', 'sort (rev)');

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
