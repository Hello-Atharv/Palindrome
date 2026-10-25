/**
 * Forward-track and back-track measurements for both engines. Each engine runs the same program on a fresh VM:
 *  - forward track: t = 0 to the end of the run (the program halts, or the step cap is reached);
 *  - back track: the end back to t = 0, by the engine's own method (the diary replays its log, the reversible
 *    engine computes the inverse of every instruction).
 * The pair is repeated until the total time is long enough to read a stable number from a browser clock.
 */
import type { CreateVm, RVM, VmKind } from '../../../spec/vm_api';
import type { ProgramVariable } from './assembler';
import { OUT_BASE, OUT_CAPACITY, OUT_LEN } from '../../../lang/src/console';

/** A run is cut here however long the caller asks for: the diary holds 48 bytes per step, so 5M steps is 240 MB. */
export const HARD_STEP_CAP = 5_000_000;
/** Without a halt, the task is the first 100,000 steps. */
export const DEFAULT_STEPS = 100_000;

export interface TrackResult {
  kind: VmKind;
  /** Steps in the run (forward track length). */
  steps: number;
  /** The program did not halt within the cap, so this is the first `steps` steps. */
  capped: boolean;
  /** Passes (forward + back) the timings were averaged over. */
  passes: number;
  /** Milliseconds for one forward track and one back track. */
  forwardMs: number;
  backMs: number;
  /** Bytes the VM holds to be able to go back, measured at the end of the run. */
  historyBytes: number;
  /** (t, history bytes) while the forward track ran, for the chart. */
  samples: { t: number; bytes: number }[];
  /** Bits the program keeps only because it cannot erase them: 32 per non-zero word of its garbage regions and of the console buffer. */
  garbageBits: number;
  /** Non-zero words of writable memory at the end of the run (what the program wrote). */
  written: number;
  /** Nanoseconds per instruction on the forward and the back track. */
  forwardNs: number;
  backNs: number;
  /** After the back track the machine is exactly where it started. */
  restored: boolean;
  /** A digest of registers, PC and memory at the end of the run (equal for correct engines). */
  endDigest: string;
}

export interface TrackOptions {
  /** Longest run to measure, in steps. */
  maxSteps?: number;
  /** Data ranges [from, to) the program keeps as garbage (ProgramInfo.garbage). */
  garbage?: readonly (readonly [number, number])[];
  /** rev programs: the variables, so register garbage is counted too. */
  variables?: readonly ProgramVariable[];
  /** Keep repeating until the forward and back tracks have each taken at least this long in total. */
  minTotalMs?: number;
}


/**
 * 32 bits for every non-zero word the program keeps only because it cannot erase it (SPEC 12.1): the console buffer, plus either
 *  - for a rev program that declares `out`, every variable that is not an `out` and no longer has its starting value
 *    (the same rule as the compiler's cost report: a flag, a leftover loop counter, a `garbage` array; registers included), or
 *  - the data ranges labelled `garbage` (assembly programs).
 * Because it is read from the machine at the current time, it rises as the program runs and falls as it is stepped back.
 */
export function garbageBitsOf(vm: RVM, ranges: readonly (readonly [number, number])[] = [], variables: readonly ProgramVariable[] = []): number {
  let words = 0;
  const count = (a: ArrayLike<number>): void => { for (let i = 0; i < a.length; i++) if (a[i] !== 0) words++; };
  if (variables.some((v) => v.isOut)) {
    const regs = vm.registers().regs;
    for (const v of variables) {
      if (v.isOut) continue;
      const now: ArrayLike<number> = v.reg ? [regs[v.reg]] : vm.memory(v.addr ?? 0, v.size);
      let changed = false;
      for (let i = 0; i < now.length; i++) if (now[i] !== (v.init[i] ?? 0)) changed = true;
      if (changed) count(now);
    }
  } else {
    for (const [from, to] of ranges) count(vm.memory(from, to - from));
  }
  const used = Math.min(vm.memory(OUT_LEN, 1)[0] >>> 0, OUT_CAPACITY) & ~1;
  if (used > 0) count(vm.memory(OUT_BASE, used));
  return words * 32;
}

function digest(vm: RVM): string {
  const { regs, pc } = vm.registers();
  let h = 0x811c9dc5;
  const mix = (v: number): void => { h = Math.imul(h ^ v, 0x01000193) >>> 0; };
  regs.forEach(mix);
  mix(pc);
  for (const w of vm.memory(0, 512)) mix(w);
  for (const w of vm.memory(0x10000, 128)) mix(w);
  for (const w of vm.framebuffer()) mix(w);
  return h.toString(16);
}

const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

/** Measure one engine. */
export async function measureTrack(createVm: CreateVm, kind: VmKind, image: Uint8Array, opts: TrackOptions = {}): Promise<TrackResult> {
  const maxSteps = Math.min(opts.maxSteps ?? DEFAULT_STEPS, HARD_STEP_CAP);
  const minTotal = opts.minTotalMs ?? 120;
  const vm = await createVm(kind);
  if (vm.loadProgram(image) !== 'ok') throw new Error(vm.lastError || 'the program was rejected');

  // find the length of the run, sampling the history for the chart (thinned to at most 96 points)
  let steps = 0;
  let status = 'ok';
  let stride = 1;
  let samples: { t: number; bytes: number }[] = [{ t: 0, bytes: vm.historyBytes }];
  while (steps < maxSteps && (status = vm.stepForward()) === 'ok') {
    steps++;
    if (steps % stride === 0) {
      samples.push({ t: steps, bytes: vm.historyBytes });
      if (samples.length > 96) { stride *= 2; samples = samples.filter((_, i) => i % 2 === 0); }
    }
  }
  if (samples[samples.length - 1].t !== steps) samples.push({ t: steps, bytes: vm.historyBytes });
  const capped = status === 'ok';
  const historyBytes = vm.historyBytes;
  const endDigest = digest(vm);
  const garbageBits = garbageBitsOf(vm, opts.garbage, opts.variables);
  const written = vm.memory(0, 0x20800).reduce((n, w) => n + (w !== 0 ? 1 : 0), 0);
  vm.runTo(0);
  const startDigest = digest(vm);

  let forwardTotal = 0;
  let backTotal = 0;
  let passes = 0;

  while (passes < 3 || (Math.min(forwardTotal, backTotal) < minTotal && passes < 5000)) {
    const a = performance.now();
    vm.runTo(steps);
    const b = performance.now();
    vm.runTo(0);
    const c = performance.now();
    forwardTotal += b - a;
    backTotal += c - b;
    passes++;
  }
  const restored = digest(vm) === startDigest;
  (vm as { destroy?: () => void }).destroy?.();
  await nextFrame();
  const forwardMs = forwardTotal / passes, backMs = backTotal / passes;
  const perStep = (ms: number): number => (steps > 0 ? (ms * 1e6) / steps : 0);
  return { kind, steps, capped, passes, forwardMs, backMs, historyBytes, samples, garbageBits, written, forwardNs: perStep(forwardMs), backNs: perStep(backMs), restored, endDigest };
}

export async function measureTracks(createVm: CreateVm, kinds: readonly VmKind[], image: Uint8Array, opts?: TrackOptions): Promise<TrackResult[]> {
  const out: TrackResult[] = [];
  for (const k of kinds) out.push(await measureTrack(createVm, k, image, opts));
  return out;
}

/** "42 ns", "1.2 µs": nanoseconds per instruction in the unit that keeps the number short. */
export function formatNs(ns: number): string {
  if (ns < 1) return '< 1 ns';
  if (ns < 1000) return `${ns < 10 ? ns.toFixed(1) : Math.round(ns)} ns`;
  return `${(ns / 1000).toFixed(2)} µs`;
}

/** "38 µs", "1.4 ms", "2.1 s": the unit that keeps the number short. */
export function formatMs(ms: number): string {
  if (ms < 5e-7) return '< 1 ns';
  if (ms < 0.001) return `${Math.round(ms * 1e6)} ns`;
  if (ms < 1) return `${(ms * 1000).toFixed(ms < 0.01 ? 1 : 0)} µs`;
  if (ms < 1000) return `${ms < 10 ? ms.toFixed(2) : ms.toFixed(1)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}
