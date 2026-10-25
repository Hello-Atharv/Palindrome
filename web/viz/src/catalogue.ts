/**
 * The programs in the picker. Every one is written in rev, and its .s is the assembly the rev compiler writes for it, so the two
 * are always the same program (and the same machine code). The picker shows the rev entry; the .s | .rev switch shows the other.
 * This file is the only place that knows where the example sources live.
 */
import { assemble } from '../../../asm/src/index';
import { compile, formatDiagnostics as formatRevDiagnostics } from '../../../lang/src/compile';
import pongRev from '../../../examples/demos/pong.rev?raw';
import fibRev from '../../../examples/rev/fib.rev?raw';
import helloRev from '../../../examples/rev/hello.rev?raw';
import sort3Rev from '../../../examples/rev/sort3.rev?raw';
import sort8Rev from '../../../examples/rev/sort8.rev?raw';
import tourRev from '../../../examples/rev/tour.rev?raw';
import type { AssembleFn } from './assembler';
import { formatDiagnostics } from './assembler';
import type { ProgramEntry } from './program';
import addTwoRev from './programs/add_two_numbers.rev?raw';
import bennettRev from './programs/bennett.rev?raw';
import callRev from './programs/call.rev?raw';
import cipherRev from './programs/cipher.rev?raw';
import gradientRev from './programs/gradient.rev?raw';
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
  const variables = c.vars.map((v) => ({ name: v.name, reg: v.reg, addr: v.addr, size: v.size, init: v.init, isOut: v.isOut }));
  return { ok: c.ok, image: c.image, diagnostics, listing, variables };
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

/** A program written in rev, with the assembly the compiler writes for it as its .s. The rev entry is the one in the picker. */
function withGeneratedAsm(rev: ProgramEntry): ProgramEntry {
  const c = compile(rev.source!);
  if (!c.ok || !c.asm) throw new Error(`${rev.name}.rev does not compile: ${formatRevDiagnostics(rev.name, c.diagnostics)}`);
  const asm = fromSource(`${rev.name} (asm)`, rev.blurb ?? '', c.asm, rev.speed, `${rev.name}.rev`);
  asm.game = rev.game; // the same program behaves the same in both languages: frame stepping, the key-log note
  link(rev, asm);
  return rev;
}

const PONG_NOTE =
  'Press Run, then use W / S or the arrow keys to move the cyan paddle. Your score is the number on the right, and the ball bounces off a grey wall. ' +
  'Miss the ball and the game halts. Back, Back one frame and the time bar rewind the game exactly, score included, replaying your keys. ' +
  'The key log is the only garbage Pong keeps (8 bytes a frame). Direction -1 is not exact for programs that read input, so rewind with Back. ' +
  'Edit the source and press Build and load.';

/** Simple programs first: they open in the Visualisation tab. Sort, cipher, Pong and the gradient are too big to animate. */
export const programs: ProgramEntry[] = [
  withGeneratedAsm(fromRev('if / else', 'watch an if / else move data through the datapath', ifElseRev)),
  withGeneratedAsm(fromRev('add two numbers', 'type two numbers; the machine adds and prints them', addTwoRev)),
  withGeneratedAsm(fromRev('loop', 'a loop that counts and adds', loopRev)),
  withGeneratedAsm(fromRev('nested loop', 'an if inside a loop', nestedRev)),
  withGeneratedAsm(fromRev('call / return', 'a procedure call and return on the stack', callRev)),
  withGeneratedAsm(fromRev('memory', 'loads, stores and the framebuffer', memoryRev)),
  withGeneratedAsm(fromRev('bennett', 'a temporary is built, used and un-built for you', bennettRev)),
  withGeneratedAsm(fromRev('my program', 'a blank template for your own program (edits are saved in this browser)', myProgramRev)),
  withGeneratedAsm(fromRev('sort', 'a reversible sort; the 19 words of flags are what it cannot erase', sort8Rev)),
  withGeneratedAsm(fromRev('cipher', 'Speck64/128: encrypt, then run it backwards to decrypt', cipherRev)),
  withGeneratedAsm(fromRev('pong', 'Pong: W / S or the arrow keys move the paddle', pongRev, { log: { addr: 0x1000, bytesPerFrame: 8 }, note: PONG_NOTE }, 10_000)),
  withGeneratedAsm(fromRev('gradient', 'fills the screen in a loop, one colour step per pixel', gradientRev)),
  withGeneratedAsm(fromRev('hello', 'prints text; step back and it un-prints', helloRev)),
  withGeneratedAsm(fromRev('fibonacci', 'Fibonacci in rev; nothing is thrown away', fibRev)),
  withGeneratedAsm(fromRev('sort of three', 'three numbers sorted with flags: the flags are the garbage', sort3Rev)),
  withGeneratedAsm(fromRev('tour', 'the whole rev language in one short program', tourRev)),
];
