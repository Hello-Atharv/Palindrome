// `rvm verify`: check a program against the contract, on both real engines. This is testing, not proof, and says so: a pass means
// "no violation found in these runs", with the numbers of runs stated.
//
// Checks
//   1 build      the program assembles / compiles (control-flow rules of SPEC 6 hold statically)
//   2 assertions the logging engine runs it to the halt with every LND assertion true
//   3 engines    both engines agree on registers, pc, memory and status after every step of the run
//   4 scrub      200 random actions (step, step back, run_to) leave the engines in identical states
//   5 inverse    undoing the whole run step by step reaches the initial state; replaying reaches the final state
//   6 backwards  (programs that do not read input) direction -1 from the end returns to the initial state
import { createWasmVm } from '../../web/wasm/src/index.js';
import type { RVM } from '../../spec/vm_api.js';
import type { Loaded } from './load.js';

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export interface VerifyResult {
  ok: boolean;
  steps: number;
  checks: Check[];
}

const MEM_WORDS = 0x20800; // data + stack + framebuffer
const same = (a: Uint32Array, b: Uint32Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

function snapshot(vm: RVM): { regs: Uint32Array; pc: number; t: number; mem: Uint32Array } {
  const r = vm.registers();
  return { regs: r.regs, pc: r.pc, t: vm.instructionCount, mem: vm.memory(0, MEM_WORDS) };
}

function diff(a: RVM, b: RVM, withMemory = true): string | null {
  const ra = a.registers();
  const rb = b.registers();
  if (a.instructionCount !== b.instructionCount) return `time ${a.instructionCount} vs ${b.instructionCount}`;
  const t = a.instructionCount;
  if (ra.pc !== rb.pc) return `pc ${ra.pc} vs ${rb.pc} at t=${t}`;
  if (!same(ra.regs, rb.regs)) return `registers differ at t=${t}`;
  if (withMemory && !same(a.memory(0, MEM_WORDS), b.memory(0, MEM_WORDS))) return `memory differs at t=${t}`;
  return null;
}

export async function verify(p: Loaded, opts: { maxSteps?: number; seed?: number } = {}): Promise<VerifyResult> {
  const maxSteps = opts.maxSteps ?? 200_000;
  const checks: Check[] = [{ name: 'build', ok: true, detail: `${p.kind === 'rev' ? 'compiled' : 'assembled'}, ${p.codeLength} instructions` }];
  const add = (name: string, ok: boolean, detail: string): void => { checks.push({ name, ok, detail }); };

  const logging = await createWasmVm('logging');
  const rev = await createWasmVm('reversible');
  let steps = 0;
  try {
    if (logging.loadProgram(p.image) !== 'ok' || rev.loadProgram(p.image) !== 'ok') {
      add('load', false, 'the image was rejected');
      return { ok: false, steps, checks };
    }
    const initial = snapshot(rev);

    // 2 + 3: run both engines in lockstep
    let divergence: string | null = null;
    let ls = 'ok';
    while (steps < maxSteps) {
      ls = logging.stepForward();
      const rs = rev.stepForward();
      if (ls !== rs) { divergence = `status ${ls} vs ${rs} at t=${steps}`; break; }
      if (ls !== 'ok') break;
      steps++;
      divergence = diff(logging, rev, steps % 64 === 0);
      if (divergence) break;
    }
    if (!divergence) divergence = diff(logging, rev);
    const halted = ls === 'halted';
    add('assertions', halted, halted ? `the logging engine ran ${steps} steps to the halt; every landing assertion held` : ls === 'fault' ? `logging engine fault at t=${steps}: ${logging.lastError}` : `did not halt within ${maxSteps} steps`);
    add('engines', !divergence, divergence ?? `identical registers and pc after every one of ${steps} steps, and identical memory every 64th step and at the end`);
    if (!halted && ls !== 'ok') return { ok: false, steps, checks };

    // 4: random scrub
    let seed = opts.seed ?? 20260424;
    const rnd = (n: number): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed >>> 8) % n; };
    let scrubDiff: string | null = null;
    const ACTIONS = 200;
    for (let i = 0; i < ACTIONS && !scrubDiff; i++) {
      const k = rnd(4);
      const t = logging.instructionCount;
      let a: string, b: string;
      if (k === 0) { a = logging.stepForward(); b = rev.stepForward(); }
      else if (k === 1) { a = logging.stepBack(); b = rev.stepBack(); }
      else { const target = Math.min(steps, Math.max(0, t + rnd(2001) - 1000)); a = logging.runTo(target); b = rev.runTo(target); }
      scrubDiff = a !== b ? `status ${a} vs ${b} on action ${i}` : diff(logging, rev);
    }
    add('scrub', !scrubDiff, scrubDiff ?? `${ACTIONS} random steps, step-backs and jumps in time: engines identical after each`);

    // 5: full undo and replay (first return to the end of the run: the scrub left both engines somewhere in the middle)
    logging.runTo(steps);
    rev.runTo(steps);
    const end = snapshot(rev);
    rev.runTo(0);
    const atStart = snapshot(rev);
    const backOk = atStart.t === 0 && atStart.pc === initial.pc && same(atStart.regs, initial.regs) && same(atStart.mem, initial.mem);
    rev.runTo(end.t);
    const replay = snapshot(rev);
    const fwdOk = replay.pc === end.pc && same(replay.regs, end.regs) && same(replay.mem, end.mem);
    add('inverse', backOk && fwdOk, backOk && fwdOk
      ? `undone ${end.t} steps to the initial state with ${rev.historyBytes} bytes of history, then replayed to the identical final state`
      : backOk ? 'replay did not reproduce the final state' : 'undoing the run did not reach the initial state');

    // 6: run the program as its own inverse (only meaningful when it does not read the input window)
    rev.runTo(end.t);
    if (rev.setDirection(-1) === 'ok') {
      let n = 0;
      let s = 'ok';
      while (n < maxSteps && (s = rev.stepForward()) === 'ok') n++;
      const back = snapshot(rev);
      const ok = s === 'halted' && back.pc === initial.pc && same(back.regs, initial.regs) && same(back.mem, initial.mem);
      add('backwards', ok, ok ? `direction -1 ran the program as its own inverse for ${n} steps and returned to the initial state` : `direction -1 did not return to the initial state (status ${s}); expected for programs that read the input window`);
    }
  } finally {
    logging.destroy();
    rev.destroy();
  }
  // direction -1 is informational for programs that may read input; everything else must pass
  const required = checks.filter((c) => c.name !== 'backwards' || p.kind === 'rev');
  return { ok: required.every((c) => c.ok), steps, checks };
}

export function formatVerify(file: string, r: VerifyResult): string {
  const o = [`${file}: ${r.ok ? 'VERIFIED (no violation found)' : 'FAILED'}`];
  for (const c of r.checks) o.push(`  ${c.ok ? 'pass' : 'FAIL'}  ${c.name.padEnd(11)} ${c.detail}`);
  o.push('  This is testing on this program and this input, not a proof.');
  return o.join('\n');
}
