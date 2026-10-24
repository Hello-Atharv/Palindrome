// Types for the Emscripten module built by vm/wasm (lib/rvm_core.js). Pointers are numbers into the wasm heap.
export interface RvmCoreModule {
  HEAPU8: Uint8Array;
  HEAPU32: Uint32Array;
  UTF8ToString(ptr: number): string;
  _malloc(bytes: number): number;
  _free(ptr: number): void;
  _rvm_version(): number;
  _rvm_create(kind: number): number;
  _rvm_destroy(vm: number): void;
  _rvm_load_program(vm: number, image: number, len: number): number;
  _rvm_set_input_tape(vm: number, tape: number, len: number): number;
  _rvm_push_input(vm: number, value: number): number;
  _rvm_step_forward(vm: number): number;
  _rvm_step_back(vm: number): number;
  _rvm_get_registers(vm: number, regs: number, pc: number): number;
  _rvm_get_memory(vm: number, addr: number, nwords: number, out: number): number;
  _rvm_get_code(vm: number, addr: number, nwords: number, out: number): number;
  _rvm_get_direction(vm: number): number;
  _rvm_set_direction(vm: number, dir: number): number;
  _rvm_last_error(vm: number): number;
  _rvm_wasm_instruction_count(vm: number): number;
  _rvm_wasm_run_to(vm: number, n: number): number;
  _rvm_wasm_history_bytes(vm: number): number;
}

export default function createRvmCore(options?: Record<string, unknown>): Promise<RvmCoreModule>;
