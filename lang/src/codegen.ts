// Code generator: rev AST -> assembly text for asm/ (spec/asm_syntax.md).
//
// Conventions
//   * Each variable lives in a register, r1.. in declaration order. r0 stays zero, r14 is the stack pointer.
//   * Every other register is a temporary. Temporaries are ZERO between statements: an expression is built into fresh
//     temporaries, used, and the build is run backwards (Bennett's trick) so nothing is left behind.
//   * `if` / `from` become the br/lnd structure of SPEC section 6. The exit assertion of an `if` and the entry assertion of a
//     loop must be conditions the machine can test directly (see ccOf); the logging VM checks every one at run time.
//   * `uncall p` calls a generated procedure p__inv, the source-level inverse of p.

import type { Cond, Expr, Program, Stmt } from './ast.js';
import { invertBlock } from './invert.js';

export class CompileError extends Error {
  constructor(readonly line: number, message: string) {
    super(message);
  }
}

/** One straight-line machine instruction we can invert. */
interface I {
  op: 'add' | 'sub' | 'xor' | 'addi' | 'xori' | 'not' | 'roli' | 'toff';
  a: number;
  b?: number;
  c?: number;
  imm?: number;
}

const text = (i: I): string => {
  switch (i.op) {
    case 'add': case 'sub': case 'xor': return `${i.op} r${i.a}, r${i.b}`;
    case 'addi': case 'xori': case 'roli': return `${i.op} r${i.a}, ${i.imm}`;
    case 'not': return `not r${i.a}`;
    case 'toff': return `toff r${i.a}, r${i.b}, r${i.c}`;
  }
};

const inverseOf = (i: I): I => {
  switch (i.op) {
    case 'add': return { ...i, op: 'sub' };
    case 'sub': return { ...i, op: 'add' };
    case 'addi': return { ...i, imm: -i.imm! };
    case 'roli': return { ...i, imm: (32 - i.imm!) % 32 };
    default: return i; // xor, xori, not, toff undo themselves
  }
};
const inverse = (ops: I[]): I[] => ops.map(inverseOf).reverse();

const ADDI_MIN = -131072;
const ADDI_MAX = 131071;
const XORI_MAX = 262143;
const fitsAddi = (v: number): boolean => v >= ADDI_MIN && v <= ADDI_MAX;

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

type Operand = { reg: number } | { imm: number };
type CC = { cc: 'eq' | 'ne' | 'lt'; swap: boolean };

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
  /** variable name -> register */
  regs: Map<string, number>;
}

export function generate(prog: Program, source: string): Generated {
  const srcLines = source.split('\n');
  const out: { text: string; line: number }[] = [];
  const regs = new Map<string, number>();
  prog.vars.forEach((v, i) => regs.set(v.name, i + 1));
  const free: number[] = [];
  for (let r = 15; r >= 1; r--) if (r !== 14 && r > prog.vars.length) free.push(r);
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
  const regOf = (name: string): number => regs.get(name)!;

  // ---- expressions: built into temporaries, then un-built ----
  function build(e: Expr, ops: I[], temps: number[]): Operand {
    if (e.k === 'num') return { imm: e.value };
    if (e.k === 'var') return { reg: regOf(e.name) };
    const toReg = (o: Operand): number => {
      if ('reg' in o) return o.reg;
      const t = alloc();
      temps.push(t);
      ops.push(...loadConst(t, o.imm));
      return t;
    };
    const xorInto = (t: number, o: Operand): void => {
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
              if (fitsAddi(v)) ops.push({ op: 'addi', a: t, imm: v });
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

  /** Run `use(reg)` with the value of e available in a register; leaves every temporary zero again. */
  function withValue(e: Expr, use: (r: number) => void): void {
    const ops: I[] = [];
    const temps: number[] = [];
    const o = build(e, ops, temps);
    let reg: number;
    if ('reg' in o) reg = o.reg;
    else {
      reg = alloc();
      temps.push(reg);
      ops.push(...loadConst(reg, o.imm));
    }
    emitOps(ops);
    use(reg);
    emitOps(inverse(ops));
    release(temps);
  }

  // ---- conditions ----
  interface Held { ops: I[]; temps: number[] }
  /** Registers holding a condition's operands; non-zero constants go in temporaries that stay until `unhold`. */
  function operands(c: Cond, held: Held): [number, number] {
    const get = (x: Cond['a']): number => {
      if (x.k === 'var') return regOf(x.name);
      if (x.value === 0) return 0;
      const t = alloc();
      held.temps.push(t);
      held.ops.push(...loadConst(t, x.value));
      return t;
    };
    return [get(c.a), get(c.b)];
  }
  const unhold = (h: Held): void => { emitOps(inverse(h.ops)); release(h.temps); };
  const pair = (c: CC, [a, b]: [number, number]): string => (c.swap ? `r${b}, r${a}` : `r${a}, r${b}`);

  // ---- statements ----
  function stmts(body: Stmt[]): void { for (const s of body) stmt(s); }

  function stmt(s: Stmt): void {
    curLine = s.line;
    const t = srcLines[s.line - 1]?.trim() ?? '';
    raw(`        ; line ${s.line}: ${t.length > 70 ? t.slice(0, 67) + '...' : t}`);
    switch (s.k) {
      case 'skip': ins('nop'); return;
      case 'swap': ins(`swap r${regOf(s.a)}, r${regOf(s.b)}`); return;
      case 'call': ins(`call p_${s.name}`); return;
      case 'uncall': need.add(s.name); ins(`call p_${s.name}__inv`); return;
      case 'assign': return assign(s);
      case 'if': return ifStmt(s);
      case 'from': return fromStmt(s);
    }
  }

  function assign(s: Extract<Stmt, { k: 'assign' }>): void {
    const x = regOf(s.target);
    const e = s.e;
    const rop = s.op === '+=' ? 'add' : s.op === '-=' ? 'sub' : 'xor';
    if (e.k === 'var') { ins(`${rop} r${x}, r${regOf(e.name)}`); return; }
    if (e.k === 'num') {
      const v = s.op === '+=' ? e.value | 0 : s.op === '-=' ? -e.value | 0 : e.value;
      if (s.op === '^=' ? e.value <= XORI_MAX : fitsAddi(v)) {
        if (s.op === '^=') { if (e.value) ins(`xori r${x}, ${e.value}`); }
        else if (v) ins(`addi r${x}, ${v}`);
        return;
      }
    }
    withValue(e, (r) => ins(`${rop} r${x}, r${r}`));
  }

  function ifStmt(s: Extract<Stmt, { k: 'if' }>): void {
    const held: Held = { ops: [], temps: [] };
    const ro = operands(s.test, held);
    const rf = operands(s.fi, held);
    emitOps(held.ops);
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
    stmts(Y);
    curLine = s.line;
    label(S1);
    if (!plan.swapped) {
      ins(`br al, ${LE}`);
      label(LX);
      ins(`lnd al, r0, r0, ${S0}`);
      stmts(X);
      curLine = s.line;
      label(LE);
      ins(`lnd ${exit.cc}, ${pair(exit, rf)}, ${S1}`);
    } else {
      const LA = newLabel('A');
      const S2 = newLabel('S');
      ins(`br al, ${LA}`);
      label(LX);
      ins(`lnd al, r0, r0, ${S0}`);
      stmts(X);
      curLine = s.line;
      label(S2);
      ins(`br al, ${LE}`);
      label(LA);
      ins(`lnd al, r0, r0, ${S1}`);
      label(LE);
      ins(`lnd ${exit.cc}, ${pair(exit, rf)}, ${S2}`);
    }
    unhold(held);
  }

  function fromStmt(s: Extract<Stmt, { k: 'from' }>): void {
    const held: Held = { ops: [], temps: [] };
    const rh = operands(s.entry, held);
    const rx = operands(s.until, held);
    const head = ccOf(s.entry, false); // holds iff we arrived by the back edge
    const exit = ccOf(s.until, true);
    if (!head || !exit) {
      throw new CompileError(s.line,
        "the loop's 'from' condition must be testable as false and its 'until' condition as true: use ==, != or <, > for 'until' and ==, !=, <=, >= for 'from'");
    }
    emitOps(held.ops);
    const H = newLabel('H');
    const SX = newLabel('S');
    const SB = newLabel('S');
    const X = newLabel('X');
    label(H);
    ins(`lnd ${head.cc}, ${pair(head, rh)}, ${SB}`);
    stmts(s.body1);
    curLine = s.line;
    label(SX);
    ins(`br ${exit.cc}, ${pair(exit, rx)}, ${X}`);
    stmts(s.body2);
    curLine = s.line;
    label(SB);
    ins(`br al, ${H}`);
    label(X);
    ins(`lnd al, r0, r0, ${SX}`);
    unhold(held);
  }

  // ---- program ----
  const need = new Set<string>(); // procedures whose inverse is called
  curLine = 0;
  label('start');
  const bodyStart = out.length;
  for (const v of prog.vars) {
    curLine = v.line;
    emitOps(loadConst(regOf(v.name), v.init));
  }
  const mainBody = prog.main ?? [];
  stmts(mainBody);
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
    regs,
  };
}
