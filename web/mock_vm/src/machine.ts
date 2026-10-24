/** Machine state, the memory map (SPEC.md section 5) and the per-step undo journal of the logging VM. */
import { FB_BASE, FB_WORDS, IN_BASE, IN_COUNT, IN_EVENTS, IN_TIME, SP_REG, STACK_BASE } from '../../../spec/vm_api';
import type { Program } from './image';
import { Tape } from './tape';

const DATA_WORDS = 0x10000;
const STACK_WORDS = 0x10000;
const IN_WORDS = 0x10000;

/** Address classes returned by Machine.region. Values below R_IN are read-write. */
export const R_DATA = 0, R_STACK = 1, R_FB = 2, R_IN = 3, R_NONE = -1;

const REG_TAG = 0x80000000;
const FLAG_TAKEN = 0x80000000; // step was a taken BR (d=+1)
const FLAG_REVERSE = 0x40000000; // step ran with d=-1

/**
 * Journal layout, growing upward: for each step, `count` pairs (tag, oldValue) then one header word
 * `prevPc | count << 16 | flags`. tag = REG_TAG|index for a register, else a data-space address.
 * Only words that actually changed are logged, so historyBytes is the honest cost of the log.
 */
export class Machine {
  readonly regs = new Uint32Array(16);
  pc = 0;
  t = 0;
  readonly tape = new Tape();
  /** Set by BR when it jumps; consumed by commitStep. */
  tookBranch = false;

  private readonly data = new Uint32Array(DATA_WORDS);
  private readonly stack = new Uint32Array(STACK_WORDS);
  private readonly fb = new Uint32Array(FB_WORDS);
  private log = new Uint32Array(1 << 14);
  private logLen = 0;
  private stepStart = 0;

  /** Reset to t = 0 for `program` (tape is left to the caller). */
  reset(program: Program): void {
    this.regs.fill(0);
    this.regs[SP_REG] = STACK_BASE;
    this.pc = program.entry;
    this.t = 0;
    this.data.fill(0);
    this.data.set(program.data);
    this.stack.fill(0);
    this.fb.fill(0);
    this.logLen = 0;
    this.stepStart = 0;
    this.tookBranch = false;
  }

  get historyBytes(): number {
    return this.logLen * 4;
  }

  // ---- memory map ----

  region(a: number): number {
    if (a < DATA_WORDS) return R_DATA;
    if (a - STACK_BASE < STACK_WORDS && a >= STACK_BASE) return R_STACK;
    if (a - FB_BASE < FB_WORDS && a >= FB_BASE) return R_FB;
    if (a - IN_BASE < IN_WORDS && a >= IN_BASE) return R_IN;
    return R_NONE;
  }

  /** Read a mapped word; the input window is evaluated at the current t. Unmapped reads give 0. */
  read(a: number): number {
    switch (this.region(a)) {
      case R_DATA: return this.data[a];
      case R_STACK: return this.stack[a - STACK_BASE];
      case R_FB: return this.fb[a - FB_BASE];
      case R_IN: return this.readWindow(a - IN_BASE);
      default: return 0;
    }
  }

  private readWindow(off: number): number {
    if (off === IN_TIME - IN_BASE) return this.t >>> 0;
    const count = this.tape.count(this.t);
    if (off === IN_COUNT - IN_BASE) return count;
    const k = off - (IN_EVENTS - IN_BASE);
    return k < count ? this.tape.value(k) : 0;
  }

  private store(a: number, v: number): void {
    switch (this.region(a)) {
      case R_DATA: this.data[a] = v; break;
      case R_STACK: this.stack[a - STACK_BASE] = v; break;
      case R_FB: this.fb[a - FB_BASE] = v; break;
    }
  }

  // ---- journaled writes (callers have already checked access) ----

  setReg(i: number, v: number): void {
    v >>>= 0;
    const old = this.regs[i];
    if (old === v) return;
    this.push(REG_TAG | i, old);
    this.regs[i] = v;
  }

  /** MEM[a] ^= v. */
  xorMem(a: number, v: number): void {
    if (v === 0) return;
    const old = this.read(a);
    this.push(a, old);
    this.store(a, (old ^ v) >>> 0);
  }

  // ---- step journal ----

  beginStep(): void {
    this.stepStart = this.logLen;
    this.tookBranch = false;
  }

  commitStep(prevPc: number, reverse: boolean): void {
    const count = (this.logLen - this.stepStart) >>> 1;
    const flags = (this.tookBranch ? FLAG_TAKEN : 0) | (reverse ? FLAG_REVERSE : 0);
    this.pushWord((prevPc | (count << 16) | flags) >>> 0);
    this.t++;
  }

  /** True if the most recent logged step was a forward (d=+1) BR that jumped from address `from`. */
  lastStepJumpedFrom(from: number): boolean {
    if (this.logLen === 0) return false;
    const h = this.log[this.logLen - 1];
    return (h & FLAG_TAKEN) !== 0 && (h & 0xffff) === from;
  }

  /** Undo the most recent logged step exactly. Caller guarantees t > 0. */
  undoStep(): void {
    const h = this.log[--this.logLen];
    const count = (h >>> 16) & 0xff;
    for (let n = 0; n < count; n++) {
      const old = this.log[--this.logLen];
      const tag = this.log[--this.logLen];
      if (tag & REG_TAG) this.regs[tag & 15] = old; else this.store(tag, old);
    }
    this.pc = h & 0xffff;
    this.t--;
  }

  private push(tag: number, old: number): void {
    this.pushWord(tag);
    this.pushWord(old);
  }

  private pushWord(w: number): void {
    if (this.logLen === this.log.length) {
      const bigger = new Uint32Array(this.log.length * 2);
      bigger.set(this.log);
      this.log = bigger;
    }
    this.log[this.logLen++] = w;
  }
}
