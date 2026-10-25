// The real C++ VMs behind the RVM interface (spec/vm_api.ts). Drop-in replacement for web/mock_vm:
//   const vm = await createWasmVm('reversible');   // or 'logging'
// Build the module first: see vm/README.md ("WebAssembly build"). A prebuilt lib/rvm_core.js is committed.
import createRvmCore, { type RvmCoreModule } from '../lib/rvm_core.js';
import { FB_BASE, FB_WORDS, type Direction, type RVM, type Registers, type Status, type VmKind } from '../../../spec/vm_api.js';

const STATUS: Record<number, Status> = {
  0: 'ok',
  1: 'halted',
  2: 'at_start',
  [-1]: 'fault',
  [-2]: 'bad_arg',
  [-3]: 'bad_program',
};

let core: Promise<RvmCoreModule> | null = null;

/** The wasm module is loaded once and shared by every VM created in this page. */
export function loadCore(): Promise<RvmCoreModule> {
  core ??= createRvmCore();
  return core;
}

export class WasmVm implements RVM {
  readonly kind: VmKind;
  private readonly m: RvmCoreModule;
  private handle: number;
  private readonly regsPtr: number; // 16 registers + pc, kept for the life of the VM

  constructor(m: RvmCoreModule, kind: VmKind) {
    this.m = m;
    this.kind = kind;
    this.handle = m._rvm_create(kind === 'logging' ? 0 : 1);
    if (this.handle === 0) throw new Error(`rvm_create failed for kind ${kind}`);
    this.regsPtr = m._malloc(17 * 4);
  }

  /** Free the VM. The object must not be used afterwards. */
  destroy(): void {
    if (this.handle === 0) return;
    this.m._free(this.regsPtr);
    this.m._rvm_destroy(this.handle);
    this.handle = 0;
  }

  private status(code: number): Status {
    return STATUS[code] ?? 'fault';
  }

  /** Copy `bytes` into the wasm heap for the duration of `fn`. */
  private withBytes<T>(bytes: Uint8Array, fn: (ptr: number, len: number) => T): T {
    const ptr = this.m._malloc(Math.max(bytes.length, 1));
    try {
      this.m.HEAPU8.set(bytes, ptr); // read HEAPU8 after malloc: the heap may have grown
      return fn(ptr, bytes.length);
    } finally {
      this.m._free(ptr);
    }
  }

  loadProgram(image: Uint8Array): Status {
    return this.status(this.withBytes(image, (p, n) => this.m._rvm_load_program(this.handle, p, n)));
  }
  setInputTape(tape: Uint8Array): Status {
    return this.status(this.withBytes(tape, (p, n) => this.m._rvm_set_input_tape(this.handle, p, n)));
  }
  pushInput(value: number): Status {
    return this.status(this.m._rvm_push_input(this.handle, value >>> 0));
  }

  stepForward(): Status {
    return this.status(this.m._rvm_step_forward(this.handle));
  }
  stepBack(): Status {
    return this.status(this.m._rvm_step_back(this.handle));
  }
  runTo(n: number): Status {
    return this.status(this.m._rvm_wasm_run_to(this.handle, n));
  }

  registers(): Registers {
    this.m._rvm_get_registers(this.handle, this.regsPtr, this.regsPtr + 64);
    const base = this.regsPtr >> 2;
    const regs = this.m.HEAPU32.slice(base, base + 16);
    return { regs, pc: this.m.HEAPU32[base + 16] };
  }

  private read(fn: (addr: number, n: number, out: number) => number, addr: number, nwords: number): number[] | null {
    if (nwords === 0) return [];
    const ptr = this.m._malloc(nwords * 4);
    try {
      if (fn(addr, nwords, ptr) !== 0) return null;
      return Array.from(this.m.HEAPU32.subarray(ptr >> 2, (ptr >> 2) + nwords));
    } finally {
      this.m._free(ptr);
    }
  }

  /**
   * Copy of nwords data-space words. Unmapped addresses read as 0, like web/mock_vm, so a UI that works with the
   * mock behaves the same here; callers should still only ask for mapped ranges.
   */
  memory(addr: number, nwords: number): Uint32Array {
    const get = (a: number, n: number, out: number): number => this.m._rvm_get_memory(this.handle, a, n, out);
    const bulk = this.read(get, addr, nwords);
    if (bulk) return Uint32Array.from(bulk);
    const out = new Uint32Array(nwords);
    for (let i = 0; i < nwords; i++) out[i] = this.read(get, addr + i, 1)?.[0] ?? 0;
    return out;
  }

  code(addr: number, nwords: number): Uint32Array {
    const words = this.read((a, n, out) => this.m._rvm_get_code(this.handle, a, n, out), addr, nwords);
    if (!words) throw new RangeError(`code range ${addr}+${nwords} is outside the program`);
    return Uint32Array.from(words);
  }

  framebuffer(): Uint32Array {
    return this.memory(FB_BASE, FB_WORDS);
  }

  get direction(): Direction {
    return this.m._rvm_get_direction(this.handle) < 0 ? -1 : 1;
  }
  setDirection(d: Direction): Status {
    return this.status(this.m._rvm_set_direction(this.handle, d));
  }

  get instructionCount(): number {
    return this.m._rvm_wasm_instruction_count(this.handle);
  }
  get historyBytes(): number {
    return this.m._rvm_wasm_history_bytes(this.handle);
  }
  get lastError(): string {
    return this.m.UTF8ToString(this.m._rvm_last_error(this.handle));
  }
}

/** Matches the CreateVm type in spec/vm_api.ts. */
export async function createWasmVm(kind: VmKind): Promise<WasmVm> {
  return new WasmVm(await loadCore(), kind);
}

export async function wasmVersion(): Promise<string> {
  const m = await loadCore();
  return m.UTF8ToString(m._rvm_version());
}

export { FRAME_WORD, FrameTracker, type FrameStep, type FrameStop } from './frames.js';
