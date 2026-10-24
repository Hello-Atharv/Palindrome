/**
 * Logging VM: implements RVM (spec/vm_api.ts) with ordinary semantics plus a per-step undo journal.
 * It is the correctness oracle: stepBack replays the journal, so it is exact by construction.
 */
import { FB_BASE, FB_WORDS } from '../../../spec/vm_api';
import type { Direction, RVM, Registers, Status, VmKind } from '../../../spec/vm_api';
import { parseImage } from './image';
import type { Program } from './image';
import { Machine } from './machine';
import { Stepper } from './semantics';

const FLIP_BYTES = 8;

export class LoggingVm implements RVM {
  readonly kind: VmKind = 'logging';
  lastError = '';

  private readonly m = new Machine();
  private prog: Program | null = null;
  private stepper: Stepper | null = null;
  /** Direction flips as (t, d) pairs, ascending in t. The step t -> t+1 uses the last flip with t' <= t. */
  private flips: { t: number; d: Direction }[] = [];

  get direction(): Direction {
    return this.directionAt(this.m.t);
  }

  get instructionCount(): number {
    return this.m.t;
  }

  get historyBytes(): number {
    return this.m.historyBytes + this.flips.length * FLIP_BYTES;
  }

  loadProgram(image: Uint8Array): Status {
    const parsed = parseImage(image);
    if (!parsed.ok) return this.fail('bad_program', parsed.error);
    this.prog = parsed.program;
    this.stepper = new Stepper(this.m, parsed.program);
    this.m.tape.clear();
    this.restart();
    return this.ok();
  }

  /** Replacing the tape restarts the run at t = 0 so the log stays consistent with it. */
  setInputTape(tape: Uint8Array): Status {
    if (!this.m.tape.load(tape)) return this.fail('bad_arg', 'malformed input tape');
    if (this.prog) this.restart();
    return this.ok();
  }

  pushInput(value: number): Status {
    this.branchHere();
    this.m.tape.append(this.m.t, value);
    return this.ok();
  }

  setDirection(d: Direction): Status {
    if (d !== 1 && d !== -1) return this.fail('bad_arg', `direction must be 1 or -1, got ${d}`);
    this.branchHere();
    const t = this.m.t;
    const last = this.flips[this.flips.length - 1];
    if (last && last.t === t) this.flips.pop();
    if (this.directionAt(t) !== d) this.flips.push({ t, d });
    return this.ok();
  }

  stepForward(): Status {
    const { m, stepper, prog } = this;
    if (!stepper || !prog) return this.noProgram();
    const reverse = this.direction === -1;
    const prevPc = m.pc;
    m.beginStep();
    let status: Status;
    if (reverse && prevPc === prog.entry) {
      stepper.error = `halted: reversed to the entry point (pc ${prevPc})`;
      status = 'halted';
    } else {
      status = reverse ? stepper.backward() : stepper.forward();
    }
    if (status === 'ok') {
      m.commitStep(prevPc, reverse);
      this.lastError = '';
    } else {
      this.lastError = stepper.error;
    }
    return status;
  }

  stepBack(): Status {
    if (!this.prog) return this.noProgram();
    if (this.m.t === 0) return this.fail('at_start', 'already at t = 0');
    this.m.undoStep();
    return this.ok();
  }

  runTo(n: number): Status {
    if (!Number.isInteger(n) || n < 0) return this.fail('bad_arg', `bad target time ${n}`);
    if (!this.prog) return this.noProgram();
    while (this.m.t > n) this.stepBack();
    while (this.m.t < n) {
      const s = this.stepForward();
      if (s !== 'ok') return s;
    }
    return this.ok();
  }

  registers(): Registers {
    return { regs: this.m.regs.slice(), pc: this.m.pc };
  }

  memory(addr: number, nwords: number): Uint32Array {
    const out = new Uint32Array(Math.max(0, nwords));
    for (let i = 0; i < out.length; i++) out[i] = this.m.read((addr + i) >>> 0);
    return out;
  }

  code(addr: number, nwords: number): Uint32Array {
    const out = new Uint32Array(Math.max(0, nwords));
    const code = this.prog?.code;
    if (code) for (let i = 0; i < out.length; i++) out[i] = code[addr + i] ?? 0;
    return out;
  }

  framebuffer(): Uint32Array {
    return this.memory(FB_BASE, FB_WORDS);
  }

  /** The program's symbol table (not part of RVM; for tools that want labels). */
  get symbols() {
    return this.prog?.symbols ?? [];
  }

  private directionAt(t: number): Direction {
    let d: Direction = 1;
    for (const f of this.flips) {
      if (f.t > t) break;
      d = f.d;
    }
    return d;
  }

  /** A host action at t: later flips and input events belong to the abandoned timeline. */
  private branchHere(): void {
    const t = this.m.t;
    while (this.flips.length && this.flips[this.flips.length - 1].t > t) this.flips.pop();
    this.m.tape.truncateAfter(t);
  }

  private restart(): void {
    if (!this.prog) return;
    this.m.reset(this.prog);
    this.flips = [];
    this.lastError = '';
  }

  private ok(): Status {
    this.lastError = '';
    return 'ok';
  }

  private fail(status: Status, msg: string): Status {
    this.lastError = msg;
    return status;
  }

  private noProgram(): Status {
    return this.fail('bad_program', 'no program loaded');
  }
}
