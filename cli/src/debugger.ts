// A headless debugger over any RVM engine (spec/vm_api.ts). It knows nothing about terminals or browsers: the REPL and, later,
// a web or VS Code front end all sit on top of this. Everything is built from stepForward/stepBack, so it works unchanged on
// both engines; on the reversible engine, going back needs no recorded history.
//
// Semantics follow SPEC 11.8. "Line" means a line of the user's source (the .rev file, or the .s file for assembly).

import type { RVM, Status } from '../../spec/vm_api.js';
import type { Loaded } from './load.js';

export type Stop = 'done' | 'breakpoint' | 'watch' | 'halted' | 'at_start' | 'fault' | 'limit';

export interface Where {
  t: number;
  pc: number;
  /** source line of the instruction about to run (0 if none) */
  line: number;
  text: string;
}

export interface WatchHit extends Where {
  /** value before and after the write */
  before: number;
  after: number;
  /** the line that did the write */
  writer: Where;
}

export const LIMIT = 1_000_000;

export type Getter = () => number;

export class Debugger {
  readonly breakpoints = new Set<number>(); // source lines

  constructor(readonly vm: RVM, readonly info: Loaded) {}

  // ---- where are we ----
  lineAt(pc: number): number {
    return this.info.pcLine.get(pc) ?? 0;
  }

  where(): Where {
    const pc = this.vm.registers().pc;
    const line = this.lineAt(pc);
    return { t: this.vm.instructionCount, pc, line, text: line ? (this.info.lines[line - 1] ?? '').trim() : '' };
  }

  get t(): number {
    return this.vm.instructionCount;
  }

  private status(s: Status): Stop {
    return s === 'ok' ? 'done' : s === 'halted' ? 'halted' : s === 'at_start' ? 'at_start' : 'fault';
  }

  private atBreakpoint(): boolean {
    if (this.breakpoints.size === 0) return false;
    const line = this.lineAt(this.vm.registers().pc);
    return line !== 0 && this.breakpoints.has(line);
  }

  // ---- single steps ----
  stepInstruction(): Stop {
    return this.status(this.vm.stepForward());
  }
  backInstruction(): Stop {
    return this.status(this.vm.stepBack());
  }

  // ---- source-level stepping ----
  /** Run forward until the next instruction belongs to a different source line. */
  stepLine(): Stop {
    const start = this.lineAt(this.vm.registers().pc);
    for (let n = 0; n < LIMIT; n++) {
      const s = this.vm.stepForward();
      if (s !== 'ok') return this.status(s);
      const line = this.lineAt(this.vm.registers().pc);
      if (line !== start && line !== 0) return 'done';
      if (this.atBreakpoint()) return 'breakpoint';
    }
    return 'limit';
  }

  /** Like stepLine, but a `call` is stepped over: stop when the stack is back at its starting depth. */
  nextLine(): Stop {
    const regs = this.vm.registers();
    const start = this.lineAt(regs.pc);
    const sp = regs.regs[14];
    for (let n = 0; n < LIMIT; n++) {
      const s = this.vm.stepForward();
      if (s !== 'ok') return this.status(s);
      const r = this.vm.registers();
      if (r.regs[14] > sp) continue; // inside a call
      const line = this.lineAt(r.pc);
      if (line !== start && line !== 0) return 'done';
      if (this.atBreakpoint()) return 'breakpoint';
    }
    return 'limit';
  }

  /** Go back to the start of the previous source line (what ran just before the current one). */
  backLine(): Stop {
    const start = this.lineAt(this.vm.registers().pc);
    let prev = 0;
    // leave the current line
    for (let n = 0; n < LIMIT; n++) {
      const s = this.vm.stepBack();
      if (s !== 'ok') return this.status(s);
      prev = this.lineAt(this.vm.registers().pc);
      if (prev !== start && prev !== 0) break;
      if (n === LIMIT - 1) return 'limit';
    }
    // keep going back to the first instruction of `prev`
    for (let n = 0; n < LIMIT; n++) {
      const s = this.vm.stepBack();
      if (s === 'at_start') return 'done';
      if (s !== 'ok') return this.status(s);
      const line = this.lineAt(this.vm.registers().pc);
      if (line !== prev) {
        this.vm.stepForward(); // overshot by one: undo that
        return 'done';
      }
    }
    return 'limit';
  }

  // ---- running ----
  /** Continue forward to a breakpoint, the halt, or the limit. */
  cont(): Stop {
    for (let n = 0; n < LIMIT * 10; n++) {
      const s = this.vm.stepForward();
      if (s !== 'ok') return this.status(s);
      if (this.atBreakpoint()) return 'breakpoint';
    }
    return 'limit';
  }

  /** Continue backward to a breakpoint or the start. */
  rcont(): Stop {
    for (let n = 0; n < LIMIT * 10; n++) {
      const s = this.vm.stepBack();
      if (s !== 'ok') return this.status(s);
      if (this.atBreakpoint()) return 'breakpoint';
    }
    return 'limit';
  }

  goto(t: number): Stop {
    return this.status(this.vm.runTo(t));
  }

  // ---- watching ----
  /** Resolve `r5`, a variable name, or `[addr]` / `mem[addr]` to a function reading it. */
  target(spec: string): Getter {
    const s = spec.trim();
    const reg = /^r(\d+)$/i.exec(s);
    if (reg && +reg[1] < 16) return () => this.vm.registers().regs[+reg[1]];
    const v = this.info.vars.find((x) => x.name === s);
    if (v) return () => this.vm.registers().regs[v.reg];
    const mem = /^(?:mem)?\[\s*(0x[0-9a-f]+|\d+)\s*\]$/i.exec(s);
    if (mem) {
      const a = Number(mem[1]);
      return () => this.vm.memory(a, 1)[0];
    }
    throw new Error(`don't know what '${spec}' is: use a variable name, r0..r15 or [address]`);
  }

  /**
   * Reverse watchpoint: go back until the watched value changes. Afterwards the machine is at the time just before the write
   * and the program counter is at the instruction that wrote it. Returns null if it does not change in the last LIMIT steps
   * (or before the start); the machine is then wherever the search stopped.
   */
  reverseWatch(get: Getter): { hit: WatchHit | null; stop: Stop } {
    const before = get();
    for (let n = 0; n < LIMIT; n++) {
      const s = this.vm.stepBack();
      if (s !== 'ok') return { hit: null, stop: this.status(s) };
      const v = get();
      if (v !== before) {
        const w = this.where();
        return { hit: { ...w, before: v, after: before, writer: w }, stop: 'watch' };
      }
      if (this.atBreakpoint()) return { hit: null, stop: 'breakpoint' };
    }
    return { hit: null, stop: 'limit' };
  }

  /** Forward watchpoint: run until the value changes. Leaves the machine just after the writing instruction. */
  forwardWatch(get: Getter): { hit: WatchHit | null; stop: Stop } {
    const before = get();
    for (let n = 0; n < LIMIT * 10; n++) {
      const writer = this.where();
      const s = this.vm.stepForward();
      if (s !== 'ok') return { hit: null, stop: this.status(s) };
      const v = get();
      if (v !== before) return { hit: { ...this.where(), before, after: v, writer }, stop: 'watch' };
      if (this.atBreakpoint()) return { hit: null, stop: 'breakpoint' };
    }
    return { hit: null, stop: 'limit' };
  }

  // ---- looking ----
  variables(): { name: string; value: number; isOut: boolean }[] {
    const regs = this.vm.registers().regs;
    return this.info.vars.map((v) => ({ name: v.name, value: regs[v.reg], isOut: v.isOut }));
  }
}
