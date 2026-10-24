/**
 * vm_api.ts - canonical TypeScript interface for the reversible machine.
 * DRAFT v0.2. Web code (visualiser, debugger) is written against this file only.
 * Implemented first by web/mock_vm, later by the WASM build of the C++ VMs (spec/vm_api.h is the
 * C ABI underneath; the two must stay in step). Any change is a spec change: log it in
 * SPEC_CHANGELOG.md. Semantics: spec/SPEC.md.
 *
 * Terms: t = instructionCount (machine time). stepForward: t -> t+1; stepBack: t -> t-1 (exact
 * inverse). direction is which way the PROGRAM runs (+1 normal, -1 program run as its own inverse).
 * Memory addresses are data-space WORD addresses.
 */

export type Status = 'ok' | 'halted' | 'at_start' | 'fault' | 'bad_arg' | 'bad_program';
export type VmKind = 'logging' | 'reversible';
export type Direction = 1 | -1;

export interface Registers {
  /** r0..r15, each an unsigned 32-bit value. r14 is the stack pointer. */
  regs: Uint32Array;
  /** Code word address of the next instruction. */
  pc: number;
}

export interface RVM {
  readonly kind: VmKind;

  /** Load a .rvm image (spec/program_format.md) and reset to t = 0. */
  loadProgram(image: Uint8Array): Status;
  /** Replace the input tape (spec/input_tape.md). */
  setInputTape(tape: Uint8Array): Status;
  /** Append an input event stamped at the current t. Starts a new branch: later events/flips dropped. */
  pushInput(value: number): Status;

  stepForward(): Status;
  stepBack(): Status;
  /** Step forward or back until instructionCount === n. Stops early on halt/fault. */
  runTo(n: number): Status;

  registers(): Registers;
  /** Copy of nwords data-space words starting at word address addr. */
  memory(addr: number, nwords: number): Uint32Array;
  /** Copy of nwords instruction words starting at code address addr (for disassembly). */
  code(addr: number, nwords: number): Uint32Array;
  /** Shorthand for memory(FB_BASE, FB_WORDS): 64x32, row-major, pixel 0x00RRGGBB. */
  framebuffer(): Uint32Array;

  readonly direction: Direction;
  /** Host action at time t: starts a new branch (later direction flips and input events dropped). */
  setDirection(d: Direction): Status;

  /** t. A JS number is exact up to 2^53. */
  readonly instructionCount: number;
  /** Bytes used to hold history. Logging VM: grows with t. Reversible VM: 8 per direction flip, 0 per step. */
  readonly historyBytes: number;
  readonly lastError: string;
}

/** Memory map (SPEC.md section 5), data space word addresses. */
export const DATA_BASE = 0x00000;
export const STACK_BASE = 0x10000;
export const FB_BASE = 0x20000;
export const FB_WIDTH = 64;
export const FB_HEIGHT = 32;
export const FB_WORDS = FB_WIDTH * FB_HEIGHT; // 2048
export const IN_BASE = 0x30000; // read-only input window
export const IN_TIME = IN_BASE + 0; // current t (low 32 bits)
export const IN_COUNT = IN_BASE + 1; // number of visible events
export const IN_EVENTS = IN_BASE + 2; // event k value at IN_EVENTS + k
export const SP_REG = 14;

/** Opcodes (SPEC.md section 4). Word layout: op[31:26] ra[25:22] rb[21:18], then imm18[17:0] or cc[17:16] target16[15:0]. */
export enum Op {
  NOP = 0, HLT, ADD, SUB, ADDI, XOR, XORI, NOT, SWAP, ROLI,
  XLD, XST, CSWAP, TOFF, BR, LND, CALL, PROC, RET,
}
export const COND = ['al', 'eq', 'ne', 'lt'] as const;

/** Factory implemented by web/mock_vm now and by the WASM wrapper later. */
export type CreateVm = (kind: VmKind) => RVM | Promise<RVM>;
