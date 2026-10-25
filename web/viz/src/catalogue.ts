/**
 * The programs in the picker. Every one is shown in both languages: assembly (.s) and rev (.rev), with a switch between them.
 *  - A program written in assembly has a hand-written rev twin (src/programs/*.rev, or examples/ for Pong and sort).
 *  - A program written in rev (hello, fibonacci, ...) has the assembly the rev compiler writes for it as its .s.
 * The two are the same program, not the same machine code: the compiler writes different instructions from a person.
 * This file is the only place that knows where the example sources live.
 */
import { assemble } from '../../../asm/src/index';
import { compile, formatDiagnostics as formatRevDiagnostics } from '../../../lang/src/compile';
import bennettS from '../../../examples/asm/bennett.s?raw';
import callS from '../../../examples/asm/call.s?raw';
import ifelseS from '../../../examples/asm/ifelse.s?raw';
import ifelseMacroS from '../../../examples/asm/ifelse_macro.s?raw';
import loopS from '../../../examples/asm/loop.s?raw';
import loopMacroS from '../../../examples/asm/loop_macro.s?raw';
import memoryS from '../../../examples/asm/memory.s?raw';
import nestedS from '../../../examples/asm/nested.s?raw';
import cipherS from '../../../examples/demos/cipher.s?raw';
import pongRev from '../../../examples/demos/pong.rev?raw';
import pongS from '../../../examples/demos/pong.s?raw';
import sortS from '../../../examples/demos/sort.s?raw';
import fibRev from '../../../examples/rev/fib.rev?raw';
import helloRev from '../../../examples/rev/hello.rev?raw';
import sort3Rev from '../../../examples/rev/sort3.rev?raw';
import sort8Rev from '../../../examples/rev/sort8.rev?raw';
import tourRev from '../../../examples/rev/tour.rev?raw';
import type { AssembleFn } from './assembler';
import { formatDiagnostics } from './assembler';
import { ADD_TWO_NUMBERS, BLANK_PROGRAM } from './examples';
import type { ProgramEntry } from './program';
import addTwoRev from './programs/add_two_numbers.rev?raw';
import bennettRev from './programs/bennett.rev?raw';
import callRev from './programs/call.rev?raw';
import cipherRev from './programs/cipher.rev?raw';
import gradientRev from './programs/gradient.rev?raw';
import gradientS from './programs/gradient.s?raw';
import ifElseRev from './programs/if_else.rev?raw';
import loopRev from './programs/loop.rev?raw';
import memoryRev from './programs/memory.rev?raw';
import myProgramRev from './programs/my_program.rev?raw';
import nestedRev from './programs/nested.rev?raw';

export const assembleHook: AssembleFn = (source, fileName = 'edited.s') => {
  const r = assemble(source, { fileName });
  return { ok: r.ok, image: r.image, diagnostics: r.diagnostics, listing: r.listing };
};

/**
 * The rev compiler in the shape of the assembler hook. Diagnostics and the listing are in terms of the rev source: the
 * compiler's line map takes each generated assembly line back to the rev line that produced it.
 */
export const compileHook: AssembleFn = (source) => {
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
const fromSource = (name: string, blurb: string, source: string, speed?: number, generatedFrom?: string): ProgramEntry => ({
  name,
  blurb,
  source,
  speed,
  generatedFrom,
  load: () => {
    const r = assembleHook(source, `${name}.s`);
    if (!r.ok || !r.image) throw new Error(formatDiagnostics(name, r.diagnostics));
    return r.image;
  },
});

const link = (a: ProgramEntry, b: ProgramEntry): void => {
  a.alt = b;
  b.alt = a;
};

/** A program written in assembly, with its hand-written rev twin. The assembly entry is the one in the picker. */
function withRevTwin(asm: ProgramEntry, revSource: string, game?: ProgramEntry['game']): ProgramEntry {
  link(asm, fromRev(`${asm.name} (rev)`, asm.blurb ?? '', revSource, game, asm.speed));
  return asm;
}

/** A program written in rev, with the assembly the compiler writes for it as its .s. The rev entry is the one in the picker. */
function withGeneratedAsm(rev: ProgramEntry): ProgramEntry {
  const c = compile(rev.source!);
  if (!c.ok || !c.asm) throw new Error(`${rev.name}.rev does not compile: ${formatRevDiagnostics(rev.name, c.diagnostics)}`);
  link(rev, fromSource(`${rev.name} (asm)`, rev.blurb ?? '', c.asm, rev.speed, `${rev.name}.rev`));
  return rev;
}

const PONG_NOTE =
  'Press Run, then use W / S or the arrow keys to move the cyan paddle. Return the ball and a yellow block lights up: that is your score. Miss it and the game halts. ' +
  'Back, Back one frame and the time bar rewind the game exactly, replaying your keys. The key log is the only garbage Pong keeps (8 bytes a frame). ' +
  'Direction -1 is not exact for programs that read input, so rewind with Back.';
const PONG_REV_NOTE =
  'Press Run, then use W / S or the arrow keys. This is the same game in rev, with a grey wall and your score as a number. ' +
  'Back, Back one frame and the time bar rewind it exactly, score included. Edit the source and press Build and load.';

/** Simple programs first: they open in the Visualisation tab. Sort, cipher, Pong and the gradient are too big to animate. */
export const programs: ProgramEntry[] = [
  withRevTwin(fromSource('if / else', 'watch an if / else move data through the datapath', ifelseMacroS), ifElseRev),
  withRevTwin(fromSource('if / else (no macros)', 'the same if / else, with the br and lnd instructions written out by hand', ifelseS), ifElseRev),
  withRevTwin(fromSource('add two numbers', 'type two numbers; the machine adds and prints them', ADD_TWO_NUMBERS), addTwoRev),
  withRevTwin(fromSource('loop', 'a loop, written with the .loop macros', loopMacroS), loopRev),
  withRevTwin(fromSource('loop (no macros)', 'the same loop, with the br and lnd instructions written out by hand', loopS), loopRev),
  withRevTwin(fromSource('nested loop', 'an if inside a loop', nestedS), nestedRev),
  withRevTwin(fromSource('call / return', 'a procedure call and return on the stack', callS), callRev),
  withRevTwin(fromSource('memory', 'loads, stores and the framebuffer', memoryS), memoryRev),
  withRevTwin(fromSource('bennett', 'a temporary is built, used and un-built for you', bennettS), bennettRev),
  withRevTwin(fromSource('my program', 'a blank template for your own program (edits are saved in this browser)', BLANK_PROGRAM), myProgramRev),
  withRevTwin(fromSource('sort', 'a reversible sort; the 19 hatched words are what it cannot erase', sortS), sort8Rev),
  withRevTwin(fromSource('cipher', 'Speck64/128: encrypt, then run it backwards to decrypt', cipherS), cipherRev),
  withRevTwin(
    { ...fromSource('pong', 'Pong: W / S or the arrow keys move the paddle', pongS, 10_000), game: { blocks: true, log: { addr: 0x1000, bytesPerFrame: 8 }, note: PONG_NOTE } },
    pongRev,
    { log: { addr: 0x1000, bytesPerFrame: 8 }, note: PONG_REV_NOTE },
  ),
  withRevTwin(fromSource('gradient', 'fills the screen in a loop, one colour step per pixel', gradientS), gradientRev),
  withGeneratedAsm(fromRev('hello', 'prints text; step back and it un-prints', helloRev)),
  withGeneratedAsm(fromRev('fibonacci', 'Fibonacci in rev; nothing is thrown away', fibRev)),
  withGeneratedAsm(fromRev('sort of three', 'three numbers sorted with flags: the flags are the garbage', sort3Rev)),
  withGeneratedAsm(fromRev('tour', 'the whole rev language in one short program', tourRev)),
];
