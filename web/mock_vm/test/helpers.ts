import type { RVM, Status } from '../../../spec/vm_api';
import { LoggingVm } from '../src/logging_vm';
import type { Built } from '../src/builder';

export function load(p: Built | Uint8Array): LoggingVm {
  const vm = new LoggingVm();
  const st = vm.loadProgram(p instanceof Uint8Array ? p : p.image);
  if (st !== 'ok') throw new Error(`load failed: ${vm.lastError}`);
  return vm;
}

/** Step forward until a non-ok status (or `max` steps). Returns that status. */
export function run(vm: RVM, max = 1_000_000): Status {
  for (let i = 0; i < max; i++) {
    const s = vm.stepForward();
    if (s !== 'ok') return s;
  }
  return 'ok';
}

export interface Snap {
  t: number;
  pc: number;
  regs: number[];
  mem: string;
}

/** Observable state: registers, pc and the RW words test programs use (data[0..2048), stack[0..256), framebuffer). */
export function snap(vm: RVM): Snap {
  const { regs, pc } = vm.registers();
  const parts = [vm.memory(0, 2048), vm.memory(0x10000, 256), vm.framebuffer()];
  let h = 0x811c9dc5;
  for (const a of parts) for (let i = 0; i < a.length; i++) h = Math.imul(h ^ a[i], 0x01000193) >>> 0;
  return { t: vm.instructionCount, pc, regs: Array.from(regs), mem: h.toString(16) };
}

/** Deterministic PRNG (mulberry32) so failures reproduce. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
