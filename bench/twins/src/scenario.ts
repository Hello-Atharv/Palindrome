// Runs a reversible program on the real engines next to its conventional twin, with identical input, and checks that the
// pictures agree. Used by the tests and by report.ts.

import { readFileSync } from 'node:fs';

import { assemble } from '../../../asm/src/index.js';
import { createWasmVm, type WasmVm } from '../../../web/wasm/src/index.js';
import { Checkpoints } from './baselines.js';
import { Conv, FB, assembleConv, runAll } from './conv.js';
import { SORT_INPUT, pongTwin, sortTwin } from './twins.js';

const program = (name: string): string => readFileSync(new URL(`../../../examples/demos/${name}`, import.meta.url), 'utf8');
export const FRAME_WORD = 0xffff;

/** Assemble examples/demos/<name> and load it on a fresh engine. */
export async function loadRev(kind: 'logging' | 'reversible', source: string): Promise<{ vm: WasmVm; codeLength: number; head: number }> {
  const asm = assemble(source);
  if (asm.diagnostics.length || !asm.image) throw new Error(`assembler: ${JSON.stringify(asm.diagnostics)}`);
  const vm = await createWasmVm(kind);
  if (vm.loadProgram(asm.image) !== 'ok') throw new Error('load failed');
  const loop = asm.listing.find((r) => r.text.includes('.loop'));
  return { vm, codeLength: asm.code.length, head: loop ? loop.addr : -1 };
}

// ---- sort ----------------------------------------------------------------------------------------------------------

export interface SortRun {
  input: number[];
  revSteps: number;
  revCodeLength: number;
  revRow0: number[];
  garbageFlags: number;
  convSteps: number;
  convCodeLength: number;
  convRow0: number[];
  conv: Conv;
  historyNaive: number;
}

export async function runSort(input: number[] = SORT_INPUT): Promise<SortRun> {
  const source = program('sort.s').replace(/^arr:.*$/m, `arr:    .word  ${input.map((x) => '0x' + x.toString(16)).join(', ')}`);
  const rev = await loadRev('reversible', source);
  const log = await loadRev('logging', source);
  while (rev.vm.stepForward() === 'ok') { /* run to the HLT */ }
  while (log.vm.stepForward() === 'ok') { /* same on the diary engine */ }
  const revRow0 = Array.from(rev.vm.memory(FB, 8));
  const garbageFlags = Array.from(rev.vm.memory(FB + 64, 19)).filter((w) => w !== 0).length;

  const twin = assembleConv(sortTwin(input));
  const conv = new Conv(twin);
  conv.diary = true;
  runAll(conv);
  const row0 = Array.from(conv.fb.slice(0, 8));
  const out: SortRun = {
    input,
    revSteps: rev.vm.instructionCount,
    revCodeLength: rev.codeLength,
    revRow0,
    garbageFlags,
    convSteps: conv.t,
    convCodeLength: twin.code.length,
    convRow0: row0,
    conv,
    historyNaive: log.vm.historyBytes,
  };
  rev.vm.destroy();
  log.vm.destroy();
  return out;
}

// ---- pong ----------------------------------------------------------------------------------------------------------

export type Strategy = 'chase' | 'none';

export interface PongRun {
  frames: number;
  hits: number;
  events: number;
  gameOver: boolean;
  revSteps: number;
  convSteps: number;
  revFrameSteps: number[];
  convFrameSteps: number[];
  revCodeLength: number;
  convCodeLength: number;
  conv: Conv;
  checkpoints: Map<number, Checkpoints>;
  historyNaive: number;
  /** non-zero words in the reversible program's own input log (its garbage) */
  revGarbageWords: number;
  /** frames at which the two pictures differed (empty when the twin is faithful) */
  mismatches: number[];
}

export async function runPong(frames: number, strategy: Strategy, checkpointIntervals: number[] = []): Promise<PongRun> {
  const source = program('pong.s');
  const rev = await loadRev('reversible', source);
  const log = await loadRev('logging', source);
  const twin = assembleConv(pongTwin());
  const conv = new Conv(twin);
  conv.diary = true;
  const cps = new Map(checkpointIntervals.map((k) => [k, new Checkpoints(k)]));
  const stepConv = (): string => {
    for (const c of cps.values()) c.before(conv);
    return conv.step();
  };

  // the setup runs to the frame loop head on the reversible side; the twin's setup runs until its first frame label
  while (rev.vm.registers().pc !== rev.head) rev.vm.stepForward();
  while (log.vm.registers().pc !== log.head) log.vm.stepForward();
  const frameLabel = twin.labels.get('frame')!;
  while (conv.pc !== frameLabel) stepConv();

  const mismatches: number[] = [];
  const revFrameSteps: number[] = [];
  const convFrameSteps: number[] = [];
  let last = 0;
  let events = 0;
  let hits = 0;
  let done = 0;
  let gameOver = false;
  for (let f = 0; f < frames; f++) {
    let ev: number | null = null;
    if (strategy === 'chase') {
      const regs = rev.vm.registers().regs;
      const ballRow = regs[7];
      const paddleRow = regs[3] >>> 27;
      const target = Math.min(28, Math.max(0, ballRow - 1));
      const want = paddleRow < target ? 0x53 : paddleRow > target ? 0x57 : 0x153;
      if (want !== last) ev = want;
    }
    if (ev !== null) {
      rev.vm.pushInput(ev);
      log.vm.pushInput(ev);
      conv.pushInput(ev);
      last = ev;
      events++;
    }
    // reversible frame: until pc returns to the loop head
    const r0 = rev.vm.instructionCount;
    let rs: string;
    do rs = rev.vm.stepForward();
    while (rs === 'ok' && rev.vm.registers().pc !== rev.head);
    let ls: string;
    do ls = log.vm.stepForward();
    while (ls === 'ok' && log.vm.registers().pc !== log.head);
    // twin frame: until the FRAME word changes
    const c0 = conv.t;
    const before = conv.data[FRAME_WORD];
    let cs: string;
    do cs = stepConv();
    while (cs === 'ok' && conv.data[FRAME_WORD] === before);

    const revOver = rs === 'halted';
    const convOver = cs === 'halted';
    if (revOver !== convOver) mismatches.push(f + 1);
    const same = Array.from(rev.vm.framebuffer()).every((w, i) => w === conv.fb[i]);
    if (!same) mismatches.push(f + 1);
    revFrameSteps.push(rev.vm.instructionCount - r0);
    convFrameSteps.push(conv.t - c0);
    if (revOver) {
      gameOver = true;
      break;
    }
    done++;
    // a hit lights a score block: count yellow pixels
    hits = Array.from(conv.fb).filter((w) => w === 0xffff00).length / 4;
  }
  const out: PongRun = {
    frames: done,
    hits,
    events,
    gameOver,
    revSteps: rev.vm.instructionCount,
    convSteps: conv.t,
    revFrameSteps,
    convFrameSteps,
    revCodeLength: rev.codeLength,
    convCodeLength: twin.code.length,
    conv,
    checkpoints: cps,
    historyNaive: log.vm.historyBytes,
    revGarbageWords: Array.from(rev.vm.memory(0x1000, 2 * frames + 2)).filter((w) => w !== 0).length,
    mismatches,
  };
  rev.vm.destroy();
  log.vm.destroy();
  return out;
}
