/**
 * Forward-track and back-track measurements for both engines. Each engine runs the same program on a fresh VM:
 *  - forward track: t = 0 to the end of the run (the program halts, or the step cap is reached);
 *  - back track: the end back to t = 0, by the engine's own method (the diary replays its log, the reversible
 *    engine computes the inverse of every instruction).
 * The pair is repeated until the total time is long enough to read a stable number from a browser clock.
 */
import type { CreateVm, RVM, VmKind } from '../../../spec/vm_api';

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
  /** After the back track the machine is exactly where it started. */
  restored: boolean;
  /** A digest of registers, PC and memory at the end of the run (equal for correct engines). */
  endDigest: string;
}

export interface TrackOptions {
  /** Longest run to measure, in steps. */
  maxSteps?: number;
  /** Keep repeating until the forward and back tracks have each taken at least this long in total. */
  minTotalMs?: number;
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
  const maxSteps = opts.maxSteps ?? 100_000;
  const minTotal = opts.minTotalMs ?? 120;
  const vm = await createVm(kind);
  if (vm.loadProgram(image) !== 'ok') throw new Error(vm.lastError || 'the program was rejected');

  // find the length of the run
  let steps = 0;
  let status = 'ok';
  while (steps < maxSteps && (status = vm.stepForward()) === 'ok') steps++;
  const capped = status === 'ok';
  const historyBytes = vm.historyBytes;
  const endDigest = digest(vm);
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
  return { kind, steps, capped, passes, forwardMs: forwardTotal / passes, backMs: backTotal / passes, historyBytes, restored, endDigest };
}

export async function measureTracks(createVm: CreateVm, kinds: readonly VmKind[], image: Uint8Array, opts?: TrackOptions): Promise<TrackResult[]> {
  const out: TrackResult[] = [];
  for (const k of kinds) out.push(await measureTrack(createVm, k, image, opts));
  return out;
}

/** "38 µs", "1.4 ms", "2.1 s": the unit that keeps the number short. */
export function formatMs(ms: number): string {
  if (ms < 0.001) return '< 1 µs';
  if (ms < 1) return `${(ms * 1000).toFixed(ms < 0.01 ? 1 : 0)} µs`;
  if (ms < 1000) return `${ms < 10 ? ms.toFixed(2) : ms.toFixed(1)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}
