// A small CONVENTIONAL machine: the same word size, memory map and input window as the reversible machine, but with the
// usual destructive instructions (mov, three-address add, store-over, ...). It exists only to be the other side of the
// comparison: the "conventional twin" of each demo program, plus the rewind strategies a conventional machine would use.
//
// The accounting (SPEC section 12) is done here, per executed instruction:
//   destroying step  = the step overwrote a value that the new state does not determine (see `destroys`).
//   full-width cost  = 32 bits per destroying step, plus ceil(log2 n) bits where control flow joins n ways.
//   tight diary      = what a real, working, bit-packed diary stores: per destroying step the old value as
//                      (its significant bits, then a 5-bit length), per join the index of the predecessor.
// The tight diary is not just counted: `undo()` really rewinds with it, and the tests check the states are exact.

export const FB = 0x20000;
export const FB_WORDS = 2048;
export const IN_BASE = 0x30000;
const DATA_WORDS = 0x10000;

export type Op =
  | 'nop' | 'halt' | 'movi' | 'mov'
  | 'add' | 'sub' | 'and' | 'or' | 'xor' | 'mul'
  | 'addi' | 'andi' | 'ori' | 'xori' | 'shli' | 'shri'
  | 'ld' | 'st' | 'jmp' | 'beq' | 'bne' | 'blt' | 'bge';

export interface Instr {
  op: Op;
  rd: number; // destination register (alu, ld, movi, mov), source register (st), first compare register (branches)
  rs: number; // first source (alu), base register (ld, st), second compare register (branches)
  rt: number; // second source (three-register alu)
  imm: number; // immediate, offset, or branch/jump target (instruction index)
  line: number;
}

const BRANCH = new Set<Op>(['beq', 'bne', 'blt', 'bge']);

// ---- assembler -----------------------------------------------------------------------------------------------------

export interface ConvProgram {
  code: Instr[];
  data: Map<number, number>; // initial data words
  labels: Map<string, number>;
  source: string;
}

const reg = (s: string, line: number): number => {
  const m = /^r(\d+)$/.exec(s.trim());
  if (!m || +m[1] > 15) throw new Error(`line ${line}: bad register '${s}'`);
  return +m[1];
};
const num = (s: string, line: number): number => {
  const t = s.trim();
  if (!/^-?(0x[0-9a-f]+|\d+)$/i.test(t)) throw new Error(`line ${line}: bad number '${s}'`);
  return Number(t);
};

/** Assemble conventional source. Lines: `label:`, `op a, b, c`, `.data addr, w0, w1, ...`; `;` starts a comment. */
export function assembleConv(source: string): ConvProgram {
  const code: Instr[] = [];
  const data = new Map<number, number>();
  const labels = new Map<string, number>();
  const fixups: { at: number; label: string; line: number }[] = [];
  source.split('\n').forEach((raw, k) => {
    const line = k + 1;
    let text = raw.replace(/;.*$/, '').trim();
    while (/^[A-Za-z_$][\w$]*:/.test(text)) {
      const name = text.slice(0, text.indexOf(':'));
      if (labels.has(name)) throw new Error(`line ${line}: duplicate label ${name}`);
      labels.set(name, code.length);
      text = text.slice(text.indexOf(':') + 1).trim();
    }
    if (!text) return;
    if (text.startsWith('.data')) {
      const [addr, ...words] = text.slice(5).split(',').map((x) => num(x, line));
      words.forEach((w, i) => data.set(addr + i, w >>> 0));
      return;
    }
    const sp = text.search(/\s/);
    const op = (sp < 0 ? text : text.slice(0, sp)) as Op;
    const args = sp < 0 ? [] : text.slice(sp).split(',').map((a) => a.trim());
    const ins: Instr = { op, rd: 0, rs: 0, rt: 0, imm: 0, line };
    const mem = (a: string): [number, number] => {
      const m = /^\[\s*(r\d+)\s*(?:([+-])\s*(-?(?:0x[0-9a-f]+|\d+)))?\s*\]$/i.exec(a);
      if (!m) throw new Error(`line ${line}: bad address '${a}'`);
      const off = m[3] === undefined ? 0 : (m[2] === '-' ? -1 : 1) * Number(m[3]);
      return [reg(m[1], line), off];
    };
    switch (op) {
      case 'nop': case 'halt': break;
      case 'movi': ins.rd = reg(args[0], line); ins.imm = num(args[1], line); break;
      case 'mov': ins.rd = reg(args[0], line); ins.rs = reg(args[1], line); break;
      case 'add': case 'sub': case 'and': case 'or': case 'xor': case 'mul':
        ins.rd = reg(args[0], line); ins.rs = reg(args[1], line); ins.rt = reg(args[2], line); break;
      case 'addi': case 'andi': case 'ori': case 'xori': case 'shli': case 'shri':
        ins.rd = reg(args[0], line); ins.rs = reg(args[1], line); ins.imm = num(args[2], line); break;
      case 'ld': ins.rd = reg(args[0], line); [ins.rs, ins.imm] = mem(args[1]); break;
      case 'st': ins.rd = reg(args[0], line); [ins.rs, ins.imm] = mem(args[1]); break;
      case 'jmp': fixups.push({ at: code.length, label: args[0], line }); break;
      case 'beq': case 'bne': case 'blt': case 'bge':
        ins.rd = reg(args[0], line); ins.rs = reg(args[1], line); fixups.push({ at: code.length, label: args[2], line }); break;
      default: throw new Error(`line ${line}: unknown instruction '${op}'`);
    }
    code.push(ins);
  });
  for (const f of fixups) {
    const t = labels.get(f.label);
    if (t === undefined) throw new Error(`line ${f.line}: unknown label '${f.label}'`);
    code[f.at].imm = t;
  }
  return { code, data, labels, source };
}

// ---- control-flow graph: where does control join? ------------------------------------------------------------------

function successors(code: Instr[], i: number): number[] {
  const ins = code[i];
  if (ins.op === 'halt') return [];
  if (ins.op === 'jmp') return [ins.imm];
  if (BRANCH.has(ins.op)) return ins.imm === i + 1 ? [i + 1] : [i + 1, ins.imm];
  return i + 1 < code.length ? [i + 1] : [];
}

/** preds[b] = sorted list of instruction indexes that can be executed immediately before b. */
export function predecessors(code: Instr[]): number[][] {
  const preds: number[][] = code.map(() => []);
  code.forEach((_, i) => successors(code, i).forEach((s) => preds[s].push(i)));
  preds.forEach((p) => p.sort((a, b) => a - b));
  return preds;
}

const ceilLog2 = (n: number): number => (n <= 1 ? 0 : 32 - Math.clz32(n - 1));

/**
 * Does executing `ins` overwrite a value that the resulting state does not determine?
 * Bijective cases (nothing destroyed): rd = rd + x, rd - x, x + rd, x - rd, rd ^ x (x is a different register or an
 * immediate), and `mov rd, rd`. Everything else that writes a register or a memory word destroys the old value.
 */
export function destroys(ins: Instr): boolean {
  switch (ins.op) {
    case 'nop': case 'halt': case 'jmp': case 'beq': case 'bne': case 'blt': case 'bge': return false;
    case 'movi': return true;
    case 'mov': return ins.rd !== ins.rs;
    case 'add': case 'xor': return (ins.rd === ins.rs) === (ins.rd === ins.rt); // bijective iff exactly one source is rd
    case 'sub': return ins.rs === ins.rt || (ins.rd !== ins.rs && ins.rd !== ins.rt);
    case 'and': case 'or': case 'mul': return true;
    case 'addi': case 'xori': return ins.rd !== ins.rs;
    case 'andi': case 'ori': case 'shli': case 'shri': return true;
    case 'ld': return true;
    case 'st': return true;
  }
}

// ---- a bit stack: the tight diary's storage ------------------------------------------------------------------------

export class BitStack {
  private bytes = new Uint8Array(1024);
  bits = 0;
  push(value: number, n: number): void {
    for (let i = 0; i < n; i++) {
      const b = Math.floor(value / 2 ** i) % 2;
      if (this.bits >> 3 >= this.bytes.length) {
        const bigger = new Uint8Array(this.bytes.length * 2);
        bigger.set(this.bytes);
        this.bytes = bigger;
      }
      if (b) this.bytes[this.bits >> 3] |= 1 << (this.bits & 7);
      else this.bytes[this.bits >> 3] &= ~(1 << (this.bits & 7));
      this.bits++;
    }
  }
  pop(n: number): number {
    let v = 0;
    for (let i = n - 1; i >= 0; i--) {
      this.bits--;
      v = v * 2 + ((this.bytes[this.bits >> 3] >> (this.bits & 7)) & 1);
    }
    return v;
  }
  get byteSize(): number {
    return Math.ceil(this.bits / 8);
  }
}

// ---- the machine ---------------------------------------------------------------------------------------------------

export type ConvStatus = 'ok' | 'halted' | 'fault';

export interface Snapshot {
  t: number;
  pc: number;
  regs: Uint32Array;
  data: Uint32Array;
  fb: Uint32Array;
}

export interface Stats {
  steps: number;
  destroyingSteps: number;
  joinBits: number;
  /** worst case: 32 bits per destroying step plus the join bits */
  bitsErased: number;
  /** distinct data/framebuffer words ever written */
  writtenWords: number;
}

export class Conv {
  regs = new Uint32Array(16);
  data = new Uint32Array(DATA_WORDS);
  fb = new Uint32Array(FB_WORDS);
  pc = 0;
  t = 0;
  halted = false;
  lastError = '';
  /** the input tape: event k becomes visible when the machine reaches time tape[k].t */
  tape: { t: number; v: number }[] = [];

  private preds: number[][];
  private writes = new Set<number>();
  destroyingSteps = 0;
  joinBits = 0;
  /** the tight diary (bit-packed old values and join indexes); only filled when `diary` is true */
  readonly stack = new BitStack();
  diary = false;

  constructor(readonly program: ConvProgram) {
    this.preds = predecessors(program.code);
    this.reset();
  }

  reset(): void {
    this.regs.fill(0);
    this.data.fill(0);
    this.fb.fill(0);
    this.program.data.forEach((v, a) => (this.data[a] = v));
    this.pc = 0;
    this.t = 0;
    this.halted = false;
    this.writes.clear();
    this.destroyingSteps = 0;
    this.joinBits = 0;
    this.stack.bits = 0;
  }

  pushInput(v: number): void {
    this.tape.push({ t: this.t, v: v >>> 0 });
  }

  private count(t: number): number {
    let n = 0;
    while (n < this.tape.length && this.tape[n].t <= t) n++;
    return n;
  }

  private read(addr: number): number {
    addr = addr >>> 0;
    if (addr < DATA_WORDS) return this.data[addr];
    if (addr >= FB && addr < FB + FB_WORDS) return this.fb[addr - FB];
    if (addr >= IN_BASE && addr < IN_BASE + 0x10000) {
      const w = addr - IN_BASE;
      if (w === 0) return this.t >>> 0;
      const c = this.count(this.t);
      if (w === 1) return c;
      return w - 2 < c ? this.tape[w - 2].v : 0;
    }
    throw new Error(`read of unmapped address 0x${addr.toString(16)}`);
  }

  private write(addr: number, v: number): void {
    addr = addr >>> 0;
    if (addr < DATA_WORDS) this.data[addr] = v;
    else if (addr >= FB && addr < FB + FB_WORDS) this.fb[addr - FB] = v;
    else throw new Error(`write to unmapped or read-only address 0x${addr.toString(16)}`);
    this.writes.add(addr);
  }

  /** Execute one instruction. */
  step(): ConvStatus {
    if (this.halted) return 'halted';
    const ins = this.program.code[this.pc];
    if (!ins) {
      this.lastError = `pc ${this.pc} outside the program`;
      return 'fault';
    }
    if (ins.op === 'halt') {
      this.halted = true;
      return 'halted';
    }
    const R = this.regs;
    const prev = this.pc;
    let next = this.pc + 1;
    let oldValue = 0;
    const kills = destroys(ins);
    try {
      switch (ins.op) {
        case 'nop': break;
        case 'movi': oldValue = R[ins.rd]; R[ins.rd] = ins.imm >>> 0; break;
        case 'mov': oldValue = R[ins.rd]; R[ins.rd] = R[ins.rs]; break;
        case 'add': { oldValue = R[ins.rd]; R[ins.rd] = (R[ins.rs] + R[ins.rt]) >>> 0; break; }
        case 'sub': { oldValue = R[ins.rd]; R[ins.rd] = (R[ins.rs] - R[ins.rt]) >>> 0; break; }
        case 'and': { oldValue = R[ins.rd]; R[ins.rd] = (R[ins.rs] & R[ins.rt]) >>> 0; break; }
        case 'or': { oldValue = R[ins.rd]; R[ins.rd] = (R[ins.rs] | R[ins.rt]) >>> 0; break; }
        case 'xor': { oldValue = R[ins.rd]; R[ins.rd] = (R[ins.rs] ^ R[ins.rt]) >>> 0; break; }
        case 'mul': { oldValue = R[ins.rd]; R[ins.rd] = Math.imul(R[ins.rs], R[ins.rt]) >>> 0; break; }
        case 'addi': oldValue = R[ins.rd]; R[ins.rd] = (R[ins.rs] + ins.imm) >>> 0; break;
        case 'andi': oldValue = R[ins.rd]; R[ins.rd] = (R[ins.rs] & ins.imm) >>> 0; break;
        case 'ori': oldValue = R[ins.rd]; R[ins.rd] = (R[ins.rs] | ins.imm) >>> 0; break;
        case 'xori': oldValue = R[ins.rd]; R[ins.rd] = (R[ins.rs] ^ ins.imm) >>> 0; break;
        case 'shli': oldValue = R[ins.rd]; R[ins.rd] = (R[ins.rs] << ins.imm) >>> 0; break;
        case 'shri': oldValue = R[ins.rd]; R[ins.rd] = R[ins.rs] >>> ins.imm; break;
        case 'ld': { const v = this.read(R[ins.rs] + ins.imm); oldValue = R[ins.rd]; R[ins.rd] = v; break; }
        case 'st': {
          const a = (R[ins.rs] + ins.imm) >>> 0;
          oldValue = this.read(a);
          this.write(a, R[ins.rd]);
          break;
        }
        case 'jmp': next = ins.imm; break;
        case 'beq': if (R[ins.rd] === R[ins.rs]) next = ins.imm; break;
        case 'bne': if (R[ins.rd] !== R[ins.rs]) next = ins.imm; break;
        case 'blt': if ((R[ins.rd] | 0) < (R[ins.rs] | 0)) next = ins.imm; break;
        case 'bge': if ((R[ins.rd] | 0) >= (R[ins.rs] | 0)) next = ins.imm; break;
      }
    } catch (e) {
      this.lastError = (e as Error).message;
      return 'fault';
    }
    if (kills) {
      this.destroyingSteps++;
      if (this.diary) {
        const len = oldValue === 0 ? 0 : 32 - Math.clz32(oldValue);
        this.stack.push(oldValue, len);
        this.stack.push(len, 6); // 0..32 needs 6 bits
      }
    }
    const np = this.preds[next];
    if (np && np.length > 1) {
      const bits = ceilLog2(np.length);
      this.joinBits += bits;
      if (this.diary) this.stack.push(np.indexOf(prev), bits);
    }
    this.pc = next;
    this.t++;
    return 'ok';
  }

  /** Undo one step using the tight diary. Needs `diary` to have been on for the whole run. */
  undo(): ConvStatus {
    if (this.t === 0) return 'fault';
    if (this.halted) this.halted = false;
    const np = this.preds[this.pc];
    let prev: number;
    if (np && np.length > 1) prev = np[this.stack.pop(ceilLog2(np.length))];
    else prev = np[0];
    const ins = this.program.code[prev];
    if (destroys(ins)) {
      const len = this.stack.pop(6);
      const old = this.stack.pop(len);
      const R = this.regs;
      if (ins.op === 'st') {
        const a = (R[ins.rs] + ins.imm) >>> 0; // rs is unchanged by a store
        this.write(a, old);
      } else {
        R[ins.rd] = old;
      }
      this.destroyingSteps--;
    } else {
      // a bijective step: compute its inverse, nothing was stored
      const R = this.regs;
      const { rd, rs, rt, imm } = ins;
      switch (ins.op) {
        case 'addi': R[rd] = (R[rd] - imm) >>> 0; break;
        case 'xori': R[rd] = (R[rd] ^ imm) >>> 0; break;
        case 'add': R[rd] = (R[rd] - R[rd === rs ? rt : rs]) >>> 0; break;
        case 'xor': R[rd] = (R[rd] ^ R[rd === rs ? rt : rs]) >>> 0; break;
        case 'sub':
          if (rd === rs) R[rd] = (R[rd] + R[rt]) >>> 0; // rd was rd - rt
          else R[rd] = (R[rs] - R[rd]) >>> 0; // rd was rs - rd
          break;
        default: break; // nop, mov rd,rd and the branches change no data
      }
    }
    if (np && np.length > 1) this.joinBits -= ceilLog2(np.length);
    this.pc = prev;
    this.t--;
    return 'ok';
  }

  snapshot(): Snapshot {
    return { t: this.t, pc: this.pc, regs: this.regs.slice(), data: this.data.slice(), fb: this.fb.slice() };
  }

  restore(s: Snapshot): void {
    this.t = s.t;
    this.pc = s.pc;
    this.regs.set(s.regs);
    this.data.set(s.data);
    this.fb.set(s.fb);
    this.halted = false;
  }

  get stats(): Stats {
    return {
      steps: this.t,
      destroyingSteps: this.destroyingSteps,
      joinBits: this.joinBits,
      bitsErased: 32 * this.destroyingSteps + this.joinBits,
      writtenWords: this.writes.size,
    };
  }

  /** A comparable fingerprint of the state (registers, pc, data, framebuffer). */
  digest(): string {
    let h = 2166136261;
    const mix = (x: number): void => {
      h ^= x;
      h = Math.imul(h, 16777619) >>> 0;
    };
    this.regs.forEach(mix);
    mix(this.pc);
    this.data.forEach(mix);
    this.fb.forEach(mix);
    return h.toString(16);
  }
}

/** Run until halt, a fault, or `max` steps. */
export function runAll(m: Conv, max = 50_000_000): ConvStatus {
  let s: ConvStatus = 'ok';
  while (m.t < max && (s = m.step()) === 'ok') { /* keep going */ }
  return s;
}
