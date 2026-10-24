// Code generator: rev AST -> assembly text for asm/ (spec/asm_syntax.md).
//
// Conventions
//   * Scalars live in registers r1.. in declaration order (layout.ts); arrays and further scalars live in data memory.
//     r0 stays zero, r14 is the stack pointer.
//   * Every other register is a temporary. Temporaries are ZERO between statements: an expression is built into fresh
//     temporaries, used, and the build is run backwards (Bennett's trick) so nothing is left behind.
//   * Memory is only ever changed by XOR (`xst`). `m += v` is done as: move the cell into a zero register (`xld` then `xst`
//     leaves the cell zero), add, move it back. Nothing is overwritten, so nothing is lost.
//   * `if` / `from` become the br/lnd structure of SPEC section 6. The exit assertion of an `if` and the entry assertion of a
//     loop must be conditions the machine can test directly (see ccOf); the logging VM checks every one at run time.
//   * `uncall p` calls a generated procedure p__inv, the source-level inverse of p.

import type { Cond, Expr, LValue, Operand, PrintItem, Program, Stmt } from './ast.js';
import { OUT_BASE, OUT_LEN } from './console.js';
import { invertBlock } from './invert.js';
import type { Layout, VarInfo } from './layout.js';

export class CompileError extends Error {
  constructor(readonly line: number, message: string) {
    super(message);
  }
}

/** One straight-line machine instruction we can invert. */
interface I {
  op: 'add' | 'sub' | 'xor' | 'addi' | 'xori' | 'not' | 'roli' | 'toff' | 'xld' | 'xst' | 'swap';
  a: number;
  b?: number;
  c?: number;
  imm?: number;
}

const mem = (base: number, off: number): string => `[r${base}${off < 0 ? '-' : '+'}${Math.abs(off)}]`;

const text = (i: I): string => {
  switch (i.op) {
    case 'add': case 'sub': case 'xor': case 'swap': return `${i.op} r${i.a}, r${i.b}`;
    case 'addi': case 'xori': case 'roli': return `${i.op} r${i.a}, ${i.imm}`;
    case 'not': return `not r${i.a}`;
    case 'toff': return `toff r${i.a}, r${i.b}, r${i.c}`;
    case 'xld': case 'xst': return `${i.op} r${i.a}, ${mem(i.b!, i.imm!)}`;
  }
};

const inverseOf = (i: I): I => {
  switch (i.op) {
    case 'add': return { ...i, op: 'sub' };
    case 'sub': return { ...i, op: 'add' };
    case 'addi': return { ...i, imm: -i.imm! };
    case 'roli': return { ...i, imm: (32 - i.imm!) % 32 };
    default: return i; // xor, xori, not, toff, xld, xst and swap undo themselves
  }
};
const inverse = (ops: I[]): I[] => ops.map(inverseOf).reverse();

const IMM_MIN = -131072;
const IMM_MAX = 131071;
const XORI_MAX = 262143;
const fitsImm = (v: number): boolean => v >= IMM_MIN && v <= IMM_MAX;
const IN_COUNT = 0x30001; // input window: COUNT; the latest event is at COUNT + 0x30001

/** Instructions that XOR the constant c into the zero register t. */
function loadConst(t: number, c: number): I[] {
  c >>>= 0;
  if (c <= XORI_MAX) return c === 0 ? [] : [{ op: 'xori', a: t, imm: c }];
  const hi = c >>> 16;
  const lo = c & 0xffff;
  const ops: I[] = [{ op: 'xori', a: t, imm: hi }, { op: 'roli', a: t, imm: 16 }];
  if (lo) ops.push({ op: 'xori', a: t, imm: lo });
  return ops;
}

type Val = { reg: number } | { imm: number };
type CC = { cc: 'eq' | 'ne' | 'lt'; swap: boolean };
/** A memory cell: the instruction form is `[reg + off]` */
interface Cell { reg: number; off: number }

/**
 * How the machine tests `c` being `truth`. It has eq, ne and signed lt only, so `a < b` and `a > b` can be tested true, and
 * `a <= b` and `a >= b` can only be tested false (a <= b is false exactly when b < a).
 */
function ccOf(c: Cond, truth: boolean): CC | null {
  switch (c.op) {
    case '==': return { cc: truth ? 'eq' : 'ne', swap: false };
    case '!=': return { cc: truth ? 'ne' : 'eq', swap: false };
    case '<': return truth ? { cc: 'lt', swap: false } : null;
    case '>': return truth ? { cc: 'lt', swap: true } : null;
    case '<=': return truth ? null : { cc: 'lt', swap: true };
    case '>=': return truth ? null : { cc: 'lt', swap: false };
  }
}

export interface Generated {
  asm: string;
  /** asm line (1-based) -> rev source line, 0 for lines that belong to no statement */
  lineMap: number[];
}

export function generate(prog: Program, source: string, lay: Layout): Generated {
  const srcLines = source.split('\n');
  const out: { text: string; line: number }[] = [];
  const info = (name: string): VarInfo => lay.vars.get(name)!;
  const numRegs = [...lay.vars.values()].filter((v) => v.kind === 'reg').length;
  const free: number[] = [];
  for (let r = 15; r >= 1; r--) if (r !== 14 && r > numRegs) free.push(r);
  let labelN = 0;
  let curLine = 0;

  const raw = (t: string): void => { out.push({ text: t, line: curLine }); };
  const ins = (t: string): void => raw(`        ${t}`);
  const label = (l: string): void => raw(`${l}:`);
  const newLabel = (p: string): string => `${p}${labelN++}`;
  const emitOps = (ops: I[]): void => ops.forEach((o) => ins(text(o)));
  const alloc = (): number => {
    const r = free.pop();
    if (r === undefined) throw new CompileError(curLine, 'out of temporary registers: split the expression using an extra variable');
    return r;
  };
  const release = (temps: number[]): void => { for (const t of [...temps].reverse()) free.push(t); };
  const regOf = (name: string): number => (info(name) as { reg: number }).reg;

  // ---- memory cells ----
  /** The cell `[reg+off]` for the constant address `a`, loading the address into a temporary if it does not fit an offset. */
  function constCell(a: number, ops: I[], temps: number[]): Cell {
    if (fitsImm(a)) return { reg: 0, off: a };
    const t = alloc();
    temps.push(t);
    ops.push(...loadConst(t, a));
    return { reg: t, off: 0 };
  }

  /** The cell of `name[index]` (index null for a scalar kept in memory). Address arithmetic goes into ops, temporaries into temps. */
  function cellOf(name: string, index: Expr | null, ops: I[], temps: number[]): Cell {
    const v = info(name) as Extract<VarInfo, { kind: 'mem' }>;
    if (index === null) return constCell(v.addr, ops, temps);
    // a[e + c] is the cell at (base + c) indexed by e: the constant costs no instruction and no temporary
    let ie = index;
    let base = v.addr;
    if (ie.k === 'bin' && (ie.op === '+' || ie.op === '-') && ie.b.k === 'num') {
      base += ie.op === '+' ? ie.b.value | 0 : -ie.b.value | 0;
      ie = ie.a;
    }
    const ix = build(ie, ops, temps);
    if ('imm' in ix) return constCell(base + ix.imm, ops, temps);
    if (fitsImm(base)) return { reg: ix.reg, off: base };
    const t = alloc();
    temps.push(t);
    ops.push(...loadConst(t, base), { op: 'add', a: t, b: ix.reg });
    return { reg: t, off: 0 };
  }

  // ---- expressions: built into temporaries, then un-built ----
  /** Constants already loaded by the instruction list `ops` (equal constants share one temporary). */
  const loaded = new WeakMap<I[], Map<number, number>>();
  function constReg(value: number, ops: I[], temps: number[]): number {
    let m = loaded.get(ops);
    if (!m) loaded.set(ops, (m = new Map()));
    const have = m.get(value >>> 0);
    if (have !== undefined) return have;
    const t = alloc();
    temps.push(t);
    ops.push(...loadConst(t, value));
    m.set(value >>> 0, t);
    return t;
  }

  function build(e: Expr, ops: I[], temps: number[]): Val {
    if (e.k === 'num') return { imm: e.value };
    if (e.k === 'var') {
      const v = info(e.name);
      if (v.kind === 'reg') return { reg: v.reg };
      const c = cellOf(e.name, null, ops, temps);
      const t = alloc();
      temps.push(t);
      ops.push({ op: 'xld', a: t, b: c.reg, imm: c.off });
      return { reg: t };
    }
    if (e.k === 'idx') {
      const c = cellOf(e.name, e.index, ops, temps);
      const t = alloc();
      temps.push(t);
      ops.push({ op: 'xld', a: t, b: c.reg, imm: c.off });
      return { reg: t };
    }
    if (e.k === 'input') {
      const tb = alloc();
      temps.push(tb);
      ops.push({ op: 'xori', a: tb, imm: IN_COUNT });
      if (e.which === 'latest') {
        const tc = alloc();
        temps.push(tc);
        ops.push({ op: 'xld', a: tc, b: tb, imm: 0 }, { op: 'add', a: tb, b: tc }); // tb = address of the latest event
      }
      const t = alloc();
      temps.push(t);
      ops.push({ op: 'xld', a: t, b: tb, imm: 0 });
      return { reg: t };
    }
    const toReg = (o: Val): number => ('reg' in o ? o.reg : constReg(o.imm, ops, temps));
    const xorInto = (t: number, o: Val): void => {
      if ('reg' in o) ops.push({ op: 'xor', a: t, b: o.reg });
      else ops.push(...loadConst(t, o.imm));
    };
    const t = alloc();
    temps.push(t);
    switch (e.k) {
      case 'not': xorInto(t, build(e.a, ops, temps)); ops.push({ op: 'not', a: t }); break;
      case 'neg': xorInto(t, build(e.a, ops, temps)); ops.push({ op: 'not', a: t }, { op: 'addi', a: t, imm: 1 }); break;
      case 'rol': xorInto(t, build(e.a, ops, temps)); if (e.n) ops.push({ op: 'roli', a: t, imm: e.n }); break;
      case 'bin': {
        let a = build(e.a, ops, temps);
        let b = build(e.b, ops, temps);
        if (e.op !== '-' && 'imm' in a && 'reg' in b) [a, b] = [b, a]; // commutative: register first
        switch (e.op) {
          case '+': case '-': {
            xorInto(t, a);
            if ('reg' in b) ops.push({ op: e.op === '+' ? 'add' : 'sub', a: t, b: b.reg });
            else {
              const v = e.op === '+' ? b.imm | 0 : -b.imm | 0;
              if (fitsImm(v)) ops.push({ op: 'addi', a: t, imm: v });
              else ops.push({ op: e.op === '+' ? 'add' : 'sub', a: t, b: toReg(b) });
            }
            break;
          }
          case '^': {
            xorInto(t, a);
            if ('reg' in b) ops.push({ op: 'xor', a: t, b: b.reg });
            else if (b.imm <= XORI_MAX) { if (b.imm) ops.push({ op: 'xori', a: t, imm: b.imm }); }
            else ops.push({ op: 'xor', a: t, b: toReg(b) });
            break;
          }
          case '&': ops.push({ op: 'toff', a: t, b: toReg(a), c: toReg(b) }); break;
          case '|': {
            const ra = toReg(a);
            const rb = toReg(b);
            ops.push({ op: 'xor', a: t, b: ra }, { op: 'xor', a: t, b: rb }, { op: 'toff', a: t, b: ra, c: rb });
            break;
          }
        }
        break;
      }
    }
    return { reg: t };
  }

  /** The register holding the value `o`, loading a constant into a new temporary if needed. */
  function inReg(o: Val, ops: I[], temps: number[]): number {
    return 'reg' in o ? o.reg : constReg(o.imm, ops, temps);
  }

  /** Run `use(reg)` with the value of e available in a register; leaves every temporary zero again. */
  function withValue(e: Expr, use: (r: number) => void): void {
    const ops: I[] = [];
    const temps: number[] = [];
    const reg = inReg(build(e, ops, temps), ops, temps);
    emitOps(ops);
    use(reg);
    emitOps(inverse(ops));
    release(temps);
  }

  // ---- conditions ----
  interface Held { ops: I[]; temps: number[] }
  /** Registers holding a condition's operands; constants and memory cells are loaded into temporaries recorded in `held`. */
  function operands(c: Cond, held: Held, consts: Held = held): [number, number] {
    const get = (x: Operand): number => {
      if (x.k === 'num') {
        if (x.value === 0) return 0;
        return constReg(x.value, consts.ops, consts.temps);
      }
      if (x.k === 'var' && info(x.name).kind === 'reg') return regOf(x.name);
      return inReg(build(x, held.ops, held.temps), held.ops, held.temps);
    };
    return [get(c.a), get(c.b)];
  }
  const pair = (c: CC, [a, b]: [number, number]): string => (c.swap ? `r${b}, r${a}` : `r${a}, r${b}`);

  // ---- statements ----
  function stmts(body: Stmt[]): void { for (const s of body) stmt(s); }

  function stmt(s: Stmt): void {
    curLine = s.line;
    const t = srcLines[s.line - 1]?.trim() ?? '';
    raw(`        ; line ${s.line}: ${t.length > 70 ? t.slice(0, 67) + '...' : t}`);
    switch (s.k) {
      case 'skip': ins('nop'); return;
      case 'swap': return swap(s.a, s.b);
      case 'print': return printStmt(s);
      case 'call': ins(`call p_${s.name}`); return;
      case 'uncall': need.add(s.name); ins(`call p_${s.name}__inv`); return;
      case 'assign': return assign(s);
      case 'if': return ifStmt(s);
      case 'from': return fromStmt(s);
    }
  }

  /**
   * print appends entries to the console (SPEC 11.9); undo (from `uncall`) removes the same entries, last first. An entry is
   * written into the two words after the current length, then the length changes by 2 in ONE step (xor in old ^ new), so the
   * console is never seen half written. Both scratch registers are zero again afterwards.
   */
  function printStmt(s: Extract<Stmt, { k: 'print' }>): void {
    const items = s.undo ? [...s.items].reverse() : s.items;
    for (const it of items) printEntry(it, !!s.undo);
  }

  function printEntry(it: PrintItem, undo: boolean): void {
    const ops: I[] = [];
    const temps: number[] = [];
    const v = build(it.e, ops, temps);
    const tagReg = it.tag ? constReg(it.tag, ops, temps) : 0;
    const valReg = 'imm' in v && v.imm === 0 ? 0 : inReg(v, ops, temps); // 0: the value word stays zero, nothing to write
    emitOps(ops);
    const t1 = alloc();
    const t2 = alloc();
    const len = `[r0+${OUT_LEN}]`;
    const at = OUT_BASE + (undo ? -2 : 0); // the entry's first word: the current length, or two words back when removing
    const d = undo ? -2 : 2;
    ins(`xld r${t1}, ${len}`); // t1 = how much has been printed
    if (it.tag) ins(`xst r${tagReg}, [r${t1}+${at}]`);
    if (valReg) ins(`xst r${valReg}, [r${t1}+${at + 1}]`);
    ins(`xor r${t2}, r${t1}`);
    ins(`addi r${t2}, ${d}`);
    ins(`xor r${t2}, r${t1}`); // t2 = old length xor new length
    ins(`xst r${t2}, ${len}`); // the length changes in one step
    ins(`xor r${t2}, r${t1}`);
    ins(`addi r${t2}, ${-d}`);
    ins(`xor r${t2}, r${t1}`); // t2 is zero again
    ins(`addi r${t1}, ${d}`);
    ins(`xld r${t1}, ${len}`); // t1 is zero again
    release([t1, t2]);
    emitOps(inverse(ops));
    release(temps);
  }

  const isReg = (lv: LValue): boolean => info(lv.name).kind === 'reg';

  function swap(a: LValue, b: LValue): void {
    if (isReg(a) && isReg(b)) { ins(`swap r${regOf(a.name)}, r${regOf(b.name)}`); return; }
    const ops: I[] = [];
    const temps: number[] = [];
    if (isReg(a) !== isReg(b)) {
      // a register and a memory cell: read the cell into t, make the cell the register's value, swap, then clear t
      const [r, m] = isReg(a) ? [a, b] : [b, a];
      const cell = cellOf(m.name, m.index ?? null, ops, temps);
      const t = alloc();
      temps.push(t);
      const x = regOf(r.name);
      emitOps(ops);
      ins(`xld r${t}, ${mem(cell.reg, cell.off)}`);
      ins(`xst r${x}, ${mem(cell.reg, cell.off)}`);
      ins(`xst r${t}, ${mem(cell.reg, cell.off)}`);
      ins(`swap r${x}, r${t}`);
      ins(`xld r${t}, ${mem(cell.reg, cell.off)}`);
      emitOps(inverse(ops));
      release(temps);
      return;
    }
    // two memory cells (possibly the same one): d = A xor B; cell1 ^= d; cell2 ^= d; then clear the temporaries
    const c1 = cellOf(a.name, a.index ?? null, ops, temps);
    const c2 = cellOf(b.name, b.index ?? null, ops, temps);
    const t1 = alloc();
    temps.push(t1);
    const t2 = alloc();
    temps.push(t2);
    emitOps(ops);
    const m1 = mem(c1.reg, c1.off);
    const m2 = mem(c2.reg, c2.off);
    ins(`xld r${t1}, ${m1}`);
    ins(`xld r${t2}, ${m2}`);
    ins(`xor r${t1}, r${t2}`);
    ins(`xst r${t1}, ${m1}`);
    ins(`xst r${t1}, ${m2}`);
    ins(`xld r${t1}, ${m1}`);
    ins(`xld r${t1}, ${m2}`);
    ins(`xld r${t2}, ${m1}`);
    emitOps(inverse(ops));
    release(temps);
  }

  function assign(s: Extract<Stmt, { k: 'assign' }>): void {
    const tgt = s.target;
    const e = s.e;
    const rop = s.op === '+=' ? 'add' : s.op === '-=' ? 'sub' : 'xor';
    if (isReg(tgt)) {
      const x = regOf(tgt.name);
      if (e.k === 'var' && info(e.name).kind === 'reg') { ins(`${rop} r${x}, r${regOf(e.name)}`); return; }
      if (e.k === 'num') {
        const v = s.op === '+=' ? e.value | 0 : s.op === '-=' ? -e.value | 0 : e.value;
        if (s.op === '^=' ? e.value <= XORI_MAX : fitsImm(v)) {
          if (s.op === '^=') { if (e.value) ins(`xori r${x}, ${e.value}`); }
          else if (v) ins(`addi r${x}, ${v}`);
          return;
        }
      }
      withValue(e, (r) => ins(`${rop} r${x}, r${r}`));
      return;
    }
    // a memory target: build the value and the address, then update the cell in place
    const ops: I[] = [];
    const temps: number[] = [];
    const v = build(e, ops, temps);
    const cell = cellOf(tgt.name, tgt.index ?? null, ops, temps);
    const m = mem(cell.reg, cell.off);
    if (s.op === '^=') {
      const r = inReg(v, ops, temps);
      emitOps(ops);
      ins(`xst r${r}, ${m}`);
    } else {
      const t = alloc();
      temps.push(t);
      let useImm = false;
      let imm = 0;
      if ('imm' in v) { imm = s.op === '+=' ? v.imm | 0 : -v.imm | 0; useImm = fitsImm(imm); }
      const r = useImm ? 0 : inReg(v, ops, temps);
      emitOps(ops);
      ins(`xld r${t}, ${m}`); // move the cell into t: the cell becomes zero
      ins(`xst r${t}, ${m}`);
      if (useImm) { if (imm) ins(`addi r${t}, ${imm}`); } else ins(`${rop} r${t}, r${r}`);
      ins(`xst r${t}, ${m}`); // and move it back
      ins(`xld r${t}, ${m}`);
    }
    emitOps(inverse(ops));
    release(temps);
  }

  function ifStmt(s: Extract<Stmt, { k: 'if' }>): void {
    // The test's operands (constants and memory cells) are loaded before the branch and cleared at the start of each body: the
    // bodies may change what they were loaded from, and a procedure called from a body assumes every temporary is zero. The
    // assertion's constants are loaded at the END of each body, just before the join, for the same reason.
    const test: Held = { ops: [], temps: [] };
    const fiHeld: Held = { ops: [], temps: [] };
    const ro = operands(s.test, test);
    const rf = operands(s.fi, fiHeld);
    emitOps(test.ops);
    const clearTest = (): void => emitOps(inverse(test.ops));
    // The entry `br` jumps into one body (X) and falls through into the other (Y). At the join, `lnd cc` asserts that cc holds
    // iff we arrived by the jump edge. Normally Y ends with that jump; when the fi condition cannot be tested the right way
    // round, X ends with it instead and Y goes through a one-instruction trampoline (two extra steps on the Y path).
    const plans = [
      { thenIsX: true, swapped: false, entry: ccOf(s.test, true), exit: ccOf(s.fi, false) },
      { thenIsX: false, swapped: false, entry: ccOf(s.test, false), exit: ccOf(s.fi, true) },
      { thenIsX: true, swapped: true, entry: ccOf(s.test, true), exit: ccOf(s.fi, true) },
      { thenIsX: false, swapped: true, entry: ccOf(s.test, false), exit: ccOf(s.fi, false) },
    ];
    const plan = plans.find((p) => p.entry && p.exit);
    if (!plan) throw new CompileError(s.line, 'internal error: no way to test this if'); // each relation is testable one way or the other
    const entry = plan.entry!;
    const exit = plan.exit!;
    const Y = plan.thenIsX ? s.else : s.then; // falls through from the entry br
    const X = plan.thenIsX ? s.then : s.else; // reached by the jump
    const S0 = newLabel('S');
    const S1 = newLabel('S');
    const LX = newLabel('J');
    const LE = newLabel('E');
    label(S0);
    ins(`br ${entry.cc}, ${pair(entry, ro)}, ${LX}`);
    clearTest();
    stmts(Y);
    curLine = s.line;
    emitOps(fiHeld.ops);
    label(S1);
    if (!plan.swapped) {
      ins(`br al, ${LE}`);
      label(LX);
      ins(`lnd al, r0, r0, ${S0}`);
      clearTest();
      stmts(X);
      curLine = s.line;
      emitOps(fiHeld.ops);
      label(LE);
      ins(`lnd ${exit.cc}, ${pair(exit, rf)}, ${S1}`);
    } else {
      const LA = newLabel('A');
      const S2 = newLabel('S');
      ins(`br al, ${LA}`);
      label(LX);
      ins(`lnd al, r0, r0, ${S0}`);
      clearTest();
      stmts(X);
      curLine = s.line;
      emitOps(fiHeld.ops);
      label(S2);
      ins(`br al, ${LE}`);
      label(LA);
      ins(`lnd al, r0, r0, ${S1}`);
      label(LE);
      ins(`lnd ${exit.cc}, ${pair(exit, rf)}, ${S2}`);
    }
    emitOps(inverse(fiHeld.ops));
    release([...fiHeld.temps, ...test.temps]);
  }

  function fromStmt(s: Extract<Stmt, { k: 'from' }>): void {
    // Constants in the conditions are loaded just before they are read and cleared right after, never held across a body (a
    // procedure called from a body assumes every temporary is zero).
    const headHeld: Held = { ops: [], temps: [] }; // the 'from' condition's constants: read by the lnd at the loop head
    const exitHeld: Held = { ops: [], temps: [] }; // the 'until' condition's constants: read by the exit br
    const rh = operands(s.entry, headHeld);
    const rx = operands(s.until, exitHeld);
    const head = ccOf(s.entry, false); // holds iff we arrived by the back edge
    const exit = ccOf(s.until, true);
    if (!head || !exit) {
      throw new CompileError(s.line,
        "the loop's 'from' condition must be testable as false and its 'until' condition as true: use ==, != or <, > for 'until' and ==, !=, <=, >= for 'from'");
    }
    const H = newLabel('H');
    const SX = newLabel('S');
    const SB = newLabel('S');
    const X = newLabel('X');
    emitOps(headHeld.ops); // first entry
    label(H);
    ins(`lnd ${head.cc}, ${pair(head, rh)}, ${SB}`);
    emitOps(inverse(headHeld.ops));
    stmts(s.body1);
    curLine = s.line;
    emitOps(exitHeld.ops);
    label(SX);
    ins(`br ${exit.cc}, ${pair(exit, rx)}, ${X}`);
    emitOps(inverse(exitHeld.ops)); // not leaving: clear before the second body
    stmts(s.body2);
    curLine = s.line;
    emitOps(headHeld.ops); // the back edge arrives at the lnd above, which reads them
    label(SB);
    ins(`br al, ${H}`);
    label(X);
    ins(`lnd al, r0, r0, ${SX}`);
    emitOps(inverse(exitHeld.ops)); // leaving: the exit br jumped here with them loaded
    release([...headHeld.temps, ...exitHeld.temps]);
  }

  // ---- program ----
  const need = new Set<string>(); // procedures whose inverse is called
  curLine = 0;
  if (lay.data.length) {
    raw('        .data');
    let cursor = 0;
    for (const chunk of lay.data) {
      if (chunk.addr > cursor) raw(`        .space ${chunk.addr - cursor}`);
      raw(`        .word ${chunk.words.map((w) => '0x' + (w >>> 0).toString(16)).join(', ')}`);
      cursor = chunk.addr + chunk.words.length;
    }
    raw('        .code');
  }
  label('start');
  const bodyStart = out.length;
  for (const v of prog.vars) {
    const vi = info(v.name);
    if (vi.kind !== 'reg') continue;
    curLine = v.line;
    emitOps(loadConst(vi.reg, v.init[0] ?? 0));
  }
  stmts(prog.main ?? []);
  curLine = prog.mainLine;
  // the entry may not be an LND: a program that opens with a loop gets a nop in front
  const firstIns = out.slice(bodyStart).find((l) => /^\s+(\w+)/.test(l.text) && !l.text.trim().startsWith(';') && !l.text.endsWith(':'));
  if (firstIns && firstIns.text.trim().startsWith('lnd')) out.splice(bodyStart, 0, { text: '        nop', line: prog.mainLine });
  else if (!firstIns) ins('nop');
  ins('hlt');

  const emitProc = (name: string, body: Stmt[], line: number): void => {
    curLine = line;
    raw('');
    raw(`; procedure ${name}`);
    label(`p_${name}`);
    ins(`proc p_${name}_end`);
    stmts(body);
    curLine = line;
    label(`p_${name}_end`);
    ins('ret');
  };
  const byName = new Map(prog.procs.map((p) => [p.name, p]));
  const done = new Set<string>();
  const queue: { name: string; inverse: boolean }[] = prog.procs.map((p) => ({ name: p.name, inverse: false }));
  while (queue.length || need.size) {
    for (const n of [...need]) { need.delete(n); queue.push({ name: n, inverse: true }); }
    const item = queue.shift();
    if (!item) break;
    const key = item.name + (item.inverse ? '__inv' : '');
    if (done.has(key)) continue;
    done.add(key);
    const p = byName.get(item.name)!;
    emitProc(key, item.inverse ? invertBlock(p.body) : p.body, p.line);
  }

  return {
    asm: out.map((l) => l.text).join('\n') + '\n',
    lineMap: out.map((l) => l.line),
  };
}
