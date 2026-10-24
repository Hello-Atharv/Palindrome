// Macros, expanded to plain instructions before assembly. See spec/asm_syntax.md.
//
// Structured control flow (Janus style, spec/SPEC.md section 6):
//   .if cc, ra, rb   ...then...   [.else ...else...]   .fi cc, ra, rb     (.fi's condition holds iff we came from the ELSE side)
//   .loop cc, ra, rb   ...body...   .again cc, ra, rb                      (.loop's condition holds iff we arrived by the back edge)
// The .if test is evaluated only on entry, so bodies may change the registers it names; what matters is that the
// .fi assertion is true after the else side and false after the then side.
//
// Compute / use / uncompute (Bennett's trick, so you never write the undo by hand):
//   .compute  ...straight-line code that builds temporaries...
//   .use      ...code that reads them and changes other state...
//   .uncompute                       emits the exact inverse of the .compute block
// The compute block must be straight-line (no branches, no labels). The use block must not change a register the
// compute block only reads (an input), or the undo could not clear the temporaries.
//
// Constants in a zero register, cleared afterwards:
//   .with reg, value  ...body...  .endwith        (value: a number or earlier .equ constants; body must not change reg)
//
// Drawing:
//   .plot colour, x, y, tmp                       XOR the pixel (x, y) of the 64-wide screen; tmp is a zero scratch register
//
// Generated labels start with "$" (user labels may not) and are hidden from the symbol table.

import type { Diagnostic } from './diag.js';
import { evalExpr } from './expr.js';
import type { Stmt } from './parser.js';

const MACROS = new Set(['.if', '.else', '.fi', '.loop', '.again', '.with', '.endwith', '.compute', '.use', '.uncompute', '.plot']);
const REG = /^(?:r(\d|1[0-5])|sp)$/i;
const SCREEN = '0x20000';

type Kind = 'if' | 'loop' | 'with' | 'compute';
interface Frame {
  kind: Kind;
  id: number;
  open: Stmt;
  inElse: boolean; // if: in the else part
  phase: 'compute' | 'use'; // compute: which part we are in
  body: Stmt[]; // then body (if), loop body, with body, compute block
  alt: Stmt[]; // else body (if), use block (compute)
  reg: string; // with: the register
  ops: [string, number][]; // with: how the constant is built
}

const regName = (s: string | undefined): string | null => {
  const m = REG.exec((s ?? '').trim());
  return m ? (m[1] === undefined ? 'r14' : 'r' + m[1]) : null;
};
const baseReg = (s: string | undefined): string | null => regName(/^\[\s*([A-Za-z0-9_]+)/.exec((s ?? '').trim())?.[1]);

/** Which registers an instruction reads and writes (memory is not tracked), or null if it is not straight-line data code. */
function effects(s: Stmt): { reads: string[]; writes: string[] } | null {
  const r = (i: number): string | null => regName(s.operands[i]);
  const list = (...xs: (string | null)[]): string[] => xs.filter((x): x is string => x !== null);
  switch (s.op) {
    case 'add': case 'sub': case 'xor':
      return { reads: list(r(0), r(1)), writes: list(r(0)) };
    case 'addi': case 'subi': case 'xori': case 'not': case 'roli': case 'neg':
      return { reads: list(r(0)), writes: list(r(0)) };
    case 'swap':
      return { reads: list(r(0), r(1)), writes: list(r(0), r(1)) };
    case 'xld':
      return { reads: list(r(0), baseReg(s.operands[1])), writes: list(r(0)) };
    case 'xst':
      return { reads: list(r(0), baseReg(s.operands[1])), writes: [] };
    case 'cswap':
      return { reads: list(r(0), r(1), r(2)), writes: list(r(1), r(2)) };
    case 'toff':
      return { reads: list(r(0), r(1), r(2)), writes: list(r(0)) };
    case 'nop':
      return { reads: [], writes: [] };
    default:
      return null;
  }
}

/** How to build `value` in a zero register: [xori v], [xori c, roli k], or [xori b, roli 14, xori a] (all constants < 2^18). */
export function constantOps(value: number): [string, number][] {
  const v = value >>> 0;
  if (v === 0) return [];
  if (v < 1 << 18) return [['xori', v]];
  const rotl = (x: number, k: number): number => ((x << k) | (x >>> (32 - k))) >>> 0;
  for (let k = 1; k < 32; k++) {
    const c = rotl(v, 32 - k); // rotl(c, k) === v
    if (c < 1 << 18) return [['xori', c], ['roli', k]];
  }
  return [['xori', v >>> 14], ['roli', 14], ['xori', v & 0x3fff]];
}
const inverseOps = (ops: [string, number][]): [string, number][] =>
  [...ops].reverse().map(([m, v]) => [m, m === 'roli' ? (32 - v) % 32 : v]);

export function expandMacros(stmts: Stmt[], diagnostics: Diagnostic[]): Stmt[] {
  const root: Stmt[] = [];
  const stack: Frame[] = [];
  let counter = 0;

  // constants known before assembly: numeric .equ lines (so .with can use names like FB)
  const consts = new Map<string, number>();
  const lookup = (n: string): number | undefined => consts.get(n);
  for (const s of stmts) {
    if (s.op === '.equ' && s.operands.length === 2) {
      const r = evalExpr(s.operands[1], lookup);
      if (r.ok) consts.set(s.operands[0], r.value);
    }
  }

  const err = (line: number, message: string): void => {
    diagnostics.push({ severity: 'error', line, message });
  };
  const sink = (): Stmt[] => {
    const f = stack[stack.length - 1];
    if (!f) return root;
    if (f.kind === 'if') return f.inElse ? f.alt : f.body;
    if (f.kind === 'compute') return f.phase === 'use' ? f.alt : f.body;
    return f.body;
  };
  const gen = (from: Stmt, labels: string[], op: string, operands: string[], note: string): Stmt => ({
    line: from.line, labels, op, operands, text: `${op} ${operands.join(', ')}    ; ${note}`,
  });
  const needThree = (s: Stmt): boolean => {
    if (s.operands.length === 3) return true;
    err(s.line, `${s.op} takes "cc, ra, rb"`);
    return false;
  };
  const isReg = (s: Stmt, i: number): boolean => {
    if (regName(s.operands[i]) !== null) return true;
    err(s.line, `${s.op}: operand ${i + 1} must be a register`);
    return false;
  };

  /** The statements that undo `s`, or an error message. */
  const invert = (s: Stmt): Stmt[] | string => {
    if (s.labels.length > 0) return 'a label inside a .compute block cannot be undone automatically';
    const same = (op: string): Stmt[] => [gen(s, [], op, s.operands, 'undo')];
    switch (s.op) {
      case 'add': return same('sub');
      case 'sub': return same('add');
      case 'addi': return same('subi');
      case 'subi': return same('addi');
      case 'xor': case 'xori': case 'not': case 'swap': case 'xld': case 'xst': case 'cswap': case 'toff': case 'nop':
        return same(s.op);
      case 'roli': {
        const n = evalExpr(s.operands[1] ?? '', lookup);
        if (!n.ok) return 'roli inside .compute needs a constant count';
        return [gen(s, [], 'roli', [s.operands[0], String((((32 - n.value) % 32) + 32) % 32)], 'undo')];
      }
      case 'neg': // neg = not; addi 1  ->  undo = subi 1; not
        return [gen(s, [], 'subi', [s.operands[0], '1'], 'undo'), gen(s, [], 'not', [s.operands[0]], 'undo')];
      default:
        return `${s.op ?? 'this statement'} cannot be undone automatically: a .compute block must be straight-line code (no branches)`;
    }
  };

  /** compute ++ use ++ inverse(compute), with the checks. Returns null (after reporting) if the block is invalid. */
  const bennett = (at: Stmt, comp: Stmt[], use: Stmt[]): Stmt[] | null => {
    let ok = true;
    const written = new Set<string>();
    const read = new Set<string>();
    for (const s of comp) {
      const e = effects(s);
      if (e) { e.reads.forEach((x) => read.add(x)); e.writes.forEach((x) => written.add(x)); }
    }
    const inputs = [...read].filter((x) => !written.has(x));
    for (const s of use) {
      const e = effects(s);
      const hit = e?.writes.find((x) => inputs.includes(x));
      if (hit) {
        err(s.line, `this changes ${hit}, which the .compute block only reads: .uncompute could not clear its temporaries`);
        ok = false;
      }
    }
    const undo: Stmt[] = [];
    for (const s of [...comp].reverse()) {
      const inv = invert(s);
      if (typeof inv === 'string') {
        err(s.line, inv);
        ok = false;
      } else {
        undo.push(...inv);
      }
    }
    if (undo.length > 0) undo[0] = { ...undo[0], line: at.line };
    return ok ? [...comp, ...use, ...undo.map((u) => ({ ...u, line: at.line }))] : null;
  };

  const frame = (kind: Kind, open: Stmt, extra: Partial<Frame> = {}): Frame => ({
    kind, id: counter++, open, inElse: false, phase: 'compute', body: [], alt: [], reg: '', ops: [], ...extra,
  });

  for (const s of stmts) {
    if (s.op === null || !MACROS.has(s.op)) {
      sink().push(s);
      continue;
    }
    switch (s.op) {
      // ---- if / else / fi and loop / again -----------------------------------------------------------------
      case '.if':
      case '.loop': {
        const good = needThree(s);
        stack.push(frame(s.op === '.if' ? 'if' : 'loop', good ? s : { ...s, operands: ['al', 'r0', 'r0'] }));
        break;
      }
      case '.else': {
        const f = stack[stack.length - 1];
        if (s.labels.length > 0) err(s.line, 'a label cannot be attached to .else');
        if (!f || f.kind !== 'if') err(s.line, '.else without a matching .if');
        else if (f.inElse) err(s.line, 'a second .else for the same .if');
        else f.inElse = true;
        break;
      }
      case '.fi': {
        const f = stack[stack.length - 1];
        if (!f || f.kind !== 'if') {
          err(s.line, '.fi without a matching .if');
          break;
        }
        stack.pop();
        if (!needThree(s)) break;
        const L = (part: string): string => `$if${f.id}_${part}`;
        const [cc, ra, rb] = f.open.operands;
        sink().push(
          { ...f.open, labels: [...f.open.labels, L('s0')], op: 'br', operands: [cc, ra, rb, L('then')] },
          ...f.alt,
          gen(s, [L('s1')], 'br', ['al', L('end')], 'jump over the then body'),
          gen(s, [L('then')], 'lnd', ['al', 'r0', 'r0', L('s0')], 'then side is entered only by the jump'),
          ...f.body,
          { ...s, labels: [...s.labels, L('end')], op: 'lnd', operands: [s.operands[0], s.operands[1], s.operands[2], L('s1')] },
        );
        break;
      }
      case '.again': {
        const f = stack[stack.length - 1];
        if (!f || f.kind !== 'loop') {
          err(s.line, '.again without a matching .loop');
          break;
        }
        stack.pop();
        if (!needThree(s)) break;
        const L = (part: string): string => `$loop${f.id}_${part}`;
        const [cc, ra, rb] = f.open.operands;
        sink().push(
          { ...f.open, labels: [...f.open.labels, L('head')], op: 'lnd', operands: [cc, ra, rb, L('back')] },
          ...f.body,
          { ...s, labels: [...s.labels, L('back')], op: 'br', operands: [s.operands[0], s.operands[1], s.operands[2], L('head')] },
        );
        break;
      }

      // ---- with / endwith ----------------------------------------------------------------------------------
      case '.with': {
        let reg = '';
        let ops: [string, number][] = [];
        if (s.operands.length !== 2) err(s.line, '.with takes "register, value"');
        else if (isReg(s, 0)) {
          reg = regName(s.operands[0])!;
          const v = evalExpr(s.operands[1], lookup);
          if (!v.ok) err(s.line, `.with value must be a constant (a number or an earlier .equ): ${v.error}`);
          else if (v.value < -2147483648 || v.value > 4294967295) err(s.line, `.with value ${v.value} does not fit in 32 bits`);
          else ops = constantOps(v.value);
        }
        stack.push(frame('with', s, { reg, ops }));
        break;
      }
      case '.endwith': {
        const f = stack[stack.length - 1];
        if (!f || f.kind !== 'with') {
          err(s.line, '.endwith without a matching .with');
          break;
        }
        stack.pop();
        for (const b of f.body) {
          if (f.reg !== '' && effects(b)?.writes.includes(f.reg)) err(b.line, `this changes ${f.reg}, which .with is holding as a constant`);
        }
        const mk = (ops: [string, number][], note: string, labels: string[]): Stmt[] =>
          ops.map(([m, v], i) => gen(f.open, i === 0 ? labels : [], m, [f.reg, String(v)], note));
        const first = mk(f.ops, `build ${f.open.operands[1] ?? ''} in ${f.reg}`, f.open.labels);
        if (first.length === 0 && f.open.labels.length > 0) first.push(gen(f.open, f.open.labels, 'nop', [], 'label'));
        sink().push(...first, ...f.body, ...mk(inverseOps(f.ops), `clear ${f.reg}`, s.labels));
        if (f.ops.length === 0 && s.labels.length > 0) sink().push(gen(s, s.labels, 'nop', [], 'label'));
        break;
      }

      // ---- compute / use / uncompute -----------------------------------------------------------------------
      case '.compute':
        stack.push(frame('compute', s));
        break;
      case '.use': {
        const f = stack[stack.length - 1];
        if (!f || f.kind !== 'compute' || f.phase !== 'compute') err(s.line, '.use without a matching .compute');
        else f.phase = 'use';
        break;
      }
      case '.uncompute': {
        const f = stack[stack.length - 1];
        if (!f || f.kind !== 'compute') {
          err(s.line, '.uncompute without a matching .compute');
          break;
        }
        stack.pop();
        if (f.phase !== 'use') {
          err(s.line, '.uncompute needs a .use block between .compute and .uncompute');
          break;
        }
        const first = f.body[0];
        const out = bennett(s, f.body, f.alt);
        if (out) {
          if (f.open.labels.length > 0 && out.length > 0) out[0] = { ...out[0], labels: [...f.open.labels, ...out[0].labels] };
          sink().push(...out);
        }
        void first;
        break;
      }

      // ---- plot --------------------------------------------------------------------------------------------
      case '.plot': {
        if (s.operands.length !== 4) {
          err(s.line, '.plot takes "colour, x, y, tmp" (registers)');
          break;
        }
        const names = [0, 1, 2, 3].map((i) => regName(s.operands[i]));
        if (names.some((n) => n === null)) {
          err(s.line, '.plot operands must be registers');
          break;
        }
        const [colour, x, y, tmp] = s.operands.map((o) => o.trim());
        if (new Set(names).size !== 4) {
          err(s.line, '.plot needs four different registers');
          break;
        }
        const comp = [
          gen(s, s.labels, 'xor', [tmp, y], 'plot: tmp = y * 64 + x + screen'),
          gen(s, [], 'roli', [tmp, '6'], 'plot'),
          gen(s, [], 'add', [tmp, x], 'plot'),
          gen(s, [], 'xori', [tmp, SCREEN], 'plot'),
        ];
        const use = [gen(s, [], 'xst', [colour, `[${tmp}+0]`], 'plot: XOR the pixel')];
        const out = bennett(s, comp, use);
        if (out) sink().push(...out);
        break;
      }
    }
  }

  for (const f of stack) {
    const closer = { if: '.fi', loop: '.again', with: '.endwith', compute: '.uncompute' }[f.kind];
    err(f.open.line, `${f.open.op} is never closed (${closer} missing)`);
  }
  return root;
}
