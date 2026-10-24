// Two-pass assembler. Pass 1 assigns addresses to labels and collects constants; pass 2 encodes.
// Source syntax: spec/asm_syntax.md. Output image: spec/program_format.md.

import { checkProgram } from './checks.js';
import type { Diagnostic } from './diag.js';
import { evalExpr } from './expr.js';
import { buildImage } from './image.js';
import {
  COND, MAX_CODE_WORDS, MAX_DATA_WORDS, OP, SIMM18_MAX, SIMM18_MIN, UIMM18_MAX,
  encB, encR, encRRR, type CondName,
} from './isa.js';
import { expandMacros } from './macros.js';
import { parse, type Stmt } from './parser.js';

export interface SymbolInfo {
  name: string;
  kind: 'code' | 'data';
  addr: number;
  line: number;
}

export interface ListingRow {
  addr: number;
  word: number;
  /** 1-based source line. */
  line: number;
  text: string;
}

/** Source map v1 (spec/program_format.md): code address to source line. */
export interface SourceMap {
  version: 1;
  files: string[];
  /** [codeAddress, fileIndex, line] for every code word. */
  code: [number, number, number][];
  labels: { name: string; kind: 'code' | 'data'; addr: number }[];
}

export interface AssembleOptions {
  fileName?: string;
}

export interface AssembleResult {
  ok: boolean;
  /** The .rvm image; present only when ok. */
  image?: Uint8Array;
  entry: number;
  code: number[];
  data: number[];
  diagnostics: Diagnostic[];
  listing: ListingRow[];
  symbols: SymbolInfo[];
  sourceMap: SourceMap;
}

const SIZE_TWO = new Set(['neg']);
const MNEMONICS = new Set([
  'nop', 'hlt', 'add', 'sub', 'addi', 'xor', 'xori', 'not', 'swap', 'roli', 'xld', 'xst',
  'cswap', 'toff', 'br', 'lnd', 'call', 'proc', 'ret', 'subi', 'neg',
]);
const REG = /^(?:r(\d|1[0-5])|sp)$/i;

type Sym = { kind: 'code' | 'data' | 'equ'; value: number; line: number };

export function assemble(source: string, opts: AssembleOptions = {}): AssembleResult {
  const fileName = opts.fileName ?? 'input.s';
  const parsed = parse(source);
  const diagnostics = parsed.diagnostics;
  const stmts = expandMacros(parsed.stmts, diagnostics);
  const err = (line: number, message: string): void => {
    diagnostics.push({ severity: 'error', line, message });
  };
  const warn = (line: number, message: string): void => {
    diagnostics.push({ severity: 'warning', line, message });
  };

  // ---- pass 1: addresses and constants ---------------------------------------------------
  const syms = new Map<string, Sym>();
  const lookup = (name: string): number | undefined => syms.get(name)?.value;
  const define = (name: string, kind: Sym['kind'], value: number, line: number): void => {
    if (REG.test(name)) return err(line, `"${name}" is a register name and cannot be a label`);
    const prior = syms.get(name);
    if (prior) return err(line, `"${name}" is already defined (line ${prior.line})`);
    syms.set(name, { kind, value, line });
  };

  type Item =
    | { kind: 'insn'; addr: number; stmt: Stmt }
    | { kind: 'word'; addr: number; stmt: Stmt };
  const items: Item[] = [];
  let section: 'code' | 'data' = 'code';
  let codeAddr = 0;
  let dataAddr = 0;
  let entryName: string | null = null;
  let entryLine = 0;

  for (const st of stmts) {
    for (const l of st.labels) {
      define(l, section, section === 'code' ? codeAddr : dataAddr, st.line);
    }
    if (st.op === null) continue;

    if (st.op.startsWith('.')) {
      switch (st.op) {
        case '.code':
        case '.text':
          section = 'code';
          break;
        case '.data':
          section = 'data';
          break;
        case '.equ': {
          if (st.operands.length !== 2) {
            err(st.line, '.equ needs a name and a value: .equ NAME, value');
            break;
          }
          const r = evalExpr(st.operands[1], lookup);
          if (!r.ok) err(st.line, `.equ ${st.operands[0]}: ${r.error}`);
          else define(st.operands[0], 'equ', r.value, st.line);
          break;
        }
        case '.entry':
          if (st.operands.length !== 1) err(st.line, '.entry needs a label');
          else {
            entryName = st.operands[0];
            entryLine = st.line;
          }
          break;
        case '.word':
          if (section !== 'data') {
            err(st.line, '.word is only allowed in the .data section');
            break;
          }
          if (st.operands.length === 0) err(st.line, '.word needs at least one value');
          for (let k = 0; k < st.operands.length; k++) {
            items.push({ kind: 'word', addr: dataAddr++, stmt: { ...st, operands: [st.operands[k]] } });
          }
          break;
        case '.space': {
          if (section !== 'data') {
            err(st.line, '.space is only allowed in the .data section');
            break;
          }
          const r = st.operands.length === 1 ? evalExpr(st.operands[0], lookup) : null;
          if (!r || !r.ok || r.value < 0) err(st.line, '.space needs a non-negative constant');
          else dataAddr += r.value;
          break;
        }
        default:
          err(st.line, `unknown directive ${st.op}`);
      }
      continue;
    }

    if (!MNEMONICS.has(st.op)) {
      err(st.line, `unknown instruction "${st.op}"`);
      continue;
    }
    if (section !== 'code') {
      err(st.line, 'instructions are only allowed in the .code section');
      continue;
    }
    items.push({ kind: 'insn', addr: codeAddr, stmt: st });
    codeAddr += SIZE_TWO.has(st.op) ? 2 : 1;
  }

  if (codeAddr > MAX_CODE_WORDS) err(0, `code is ${codeAddr} words; the limit is ${MAX_CODE_WORDS}`);
  if (dataAddr > MAX_DATA_WORDS) err(0, `data is ${dataAddr} words; the limit is ${MAX_DATA_WORDS}`);

  // ---- pass 2: encode ----------------------------------------------------------------------
  const code: number[] = [];
  const lineOf: number[] = [];
  const data: number[] = dataAddr <= MAX_DATA_WORDS ? new Array<number>(dataAddr).fill(0) : [];
  const listing: ListingRow[] = [];

  const emit = (word: number, st: Stmt): void => {
    const addr = code.length;
    code.push(word >>> 0);
    lineOf.push(st.line);
    listing.push({ addr, word: word >>> 0, line: st.line, text: st.text });
  };

  for (const item of items) {
    const st = item.stmt;
    const line = st.line;

    if (item.kind === 'word') {
      const r = evalExpr(st.operands[0], lookup);
      if (!r.ok) err(line, `.word: ${r.error}`);
      else if (r.value < -2147483648 || r.value > 4294967295) err(line, `.word value ${r.value} does not fit in 32 bits`);
      else data[item.addr] = r.value >>> 0;
      continue;
    }

    const ops = st.operands;
    const before = code.length;
    const need = (n: number): boolean => {
      if (ops.length === n) return true;
      err(line, `${st.op} takes ${n} operand${n === 1 ? '' : 's'}, got ${ops.length}`);
      return false;
    };
    const reg = (text: string): number | null => {
      const m = REG.exec(text.trim());
      if (!m) {
        err(line, `expected a register (r0-r15 or sp), got "${text}"`);
        return null;
      }
      return m[1] === undefined ? 14 : parseInt(m[1], 10);
    };
    const value = (text: string): number | null => {
      const r = evalExpr(text, lookup);
      if (!r.ok) {
        err(line, r.error);
        return null;
      }
      return r.value;
    };
    const ranged = (text: string, min: number, max: number, what: string): number | null => {
      const v = value(text);
      if (v === null) return null;
      if (v < min || v > max) {
        err(line, `${what} ${v} is out of range (${min} to ${max})`);
        return null;
      }
      return v;
    };
    const codeLabel = (text: string): number | null => {
      const s = syms.get(text.trim());
      if (!s) {
        err(line, `undefined label "${text}"`);
        return null;
      }
      if (s.kind !== 'code') {
        err(line, `"${text}" is not a code label`);
        return null;
      }
      return s.value;
    };
    const memory = (text: string): { base: number; off: number } | null => {
      const m = /^\[\s*([A-Za-z0-9_]+)\s*(.*?)\s*\]$/.exec(text.trim());
      if (!m) {
        err(line, `expected a memory operand like [r1+4], got "${text}"`);
        return null;
      }
      const base = reg(m[1]);
      let off = 0;
      if (m[2] !== '') {
        if (m[2][0] !== '+' && m[2][0] !== '-') {
          err(line, `expected + or - after the base register in "${text}"`);
          return null;
        }
        const o = ranged(m[2], SIMM18_MIN, SIMM18_MAX, 'offset');
        if (o === null) return null;
        off = o;
      }
      return base === null ? null : { base, off };
    };
    const cond = (text: string): number | null => {
      const c = text.trim().toLowerCase() as CondName;
      if (c in COND) return COND[c];
      err(line, `unknown condition "${text}" (use al, eq, ne or lt)`);
      return null;
    };
    // br / lnd: cc, label   (cc must be al)   or   cc, ra, rb, label
    const branch = (op: number): void => {
      if (ops.length !== 2 && ops.length !== 4) {
        err(line, `${st.op} takes "cc, label" (cc = al) or "cc, ra, rb, label"`);
        return;
      }
      const cc = cond(ops[0]);
      let ra: number | null = 0;
      let rb: number | null = 0;
      if (ops.length === 4) {
        ra = reg(ops[1]);
        rb = reg(ops[2]);
      } else if (cc !== COND.al) {
        err(line, `${st.op} with condition ${ops[0]} needs two registers: cc, ra, rb, label`);
        return;
      }
      const target = codeLabel(ops[ops.length - 1]);
      if (cc === null || ra === null || rb === null || target === null) return;
      emit(encB(op, ra, rb, cc, target), st);
    };

    switch (st.op) {
      case 'nop':
        if (need(0)) emit(encR(OP.NOP, 0, 0, 0), st);
        break;
      case 'hlt':
        if (need(0)) emit(encR(OP.HLT, 0, 0, 0), st);
        break;
      case 'ret':
        if (need(0)) emit(encR(OP.RET, 0, 0, 0), st);
        break;
      case 'add':
      case 'sub':
      case 'xor': {
        if (!need(2)) break;
        const a = reg(ops[0]);
        const b = reg(ops[1]);
        if (a === null || b === null) break;
        if (a === b) {
          err(line, `${st.op} needs two different registers (equal operands would not be reversible)`);
          break;
        }
        emit(encR({ add: OP.ADD, sub: OP.SUB, xor: OP.XOR }[st.op], a, b, 0), st);
        break;
      }
      case 'swap': {
        if (!need(2)) break;
        const a = reg(ops[0]);
        const b = reg(ops[1]);
        if (a === null || b === null) break;
        if (a === b) warn(line, 'swap of a register with itself has no effect');
        emit(encR(OP.SWAP, a, b, 0), st);
        break;
      }
      case 'not': {
        if (!need(1)) break;
        const a = reg(ops[0]);
        if (a !== null) emit(encR(OP.NOT, a, 0, 0), st);
        break;
      }
      case 'neg': {
        if (!need(1)) break;
        const a = reg(ops[0]);
        if (a === null) break;
        emit(encR(OP.NOT, a, 0, 0), st);
        emit(encR(OP.ADDI, a, 0, 1), st);
        break;
      }
      case 'addi': {
        if (!need(2)) break;
        const a = reg(ops[0]);
        const v = ranged(ops[1], SIMM18_MIN, SIMM18_MAX, 'immediate');
        if (a !== null && v !== null) emit(encR(OP.ADDI, a, 0, v), st);
        break;
      }
      case 'subi': {
        if (!need(2)) break;
        const a = reg(ops[0]);
        const v = ranged(ops[1], -SIMM18_MAX, -SIMM18_MIN, 'immediate');
        if (a !== null && v !== null) emit(encR(OP.ADDI, a, 0, -v), st);
        break;
      }
      case 'xori': {
        if (!need(2)) break;
        const a = reg(ops[0]);
        const v = ranged(ops[1], 0, UIMM18_MAX, 'immediate');
        if (a !== null && v !== null) emit(encR(OP.XORI, a, 0, v), st);
        break;
      }
      case 'roli': {
        if (!need(2)) break;
        const a = reg(ops[0]);
        const v = ranged(ops[1], 0, 31, 'rotate count');
        if (a !== null && v !== null) emit(encR(OP.ROLI, a, 0, v), st);
        break;
      }
      case 'xld':
      case 'xst': {
        if (!need(2)) break;
        const a = reg(ops[0]);
        const m = memory(ops[1]);
        if (a === null || m === null) break;
        if (st.op === 'xld' && a === m.base) {
          err(line, 'xld needs a destination register different from the base register');
          break;
        }
        emit(encR(st.op === 'xld' ? OP.XLD : OP.XST, a, m.base, m.off), st);
        break;
      }
      case 'cswap': {
        if (!need(3)) break;
        const c = reg(ops[0]);
        const a = reg(ops[1]);
        const b = reg(ops[2]);
        if (c === null || a === null || b === null) break;
        if (c === a || c === b) {
          err(line, 'cswap: the control register must differ from the two swapped registers');
          break;
        }
        emit(encRRR(OP.CSWAP, a, b, c), st);
        break;
      }
      case 'toff': {
        if (!need(3)) break;
        const a = reg(ops[0]);
        const b = reg(ops[1]);
        const c = reg(ops[2]);
        if (a === null || b === null || c === null) break;
        if (a === b || a === c) {
          err(line, 'toff: the target register must differ from the two control registers');
          break;
        }
        emit(encRRR(OP.TOFF, a, b, c), st);
        break;
      }
      case 'br':
        branch(OP.BR);
        break;
      case 'lnd':
        branch(OP.LND);
        break;
      case 'call': {
        if (!need(1)) break;
        const t = codeLabel(ops[0]);
        if (t !== null) emit(encB(OP.CALL, 0, 0, 0, t), st);
        break;
      }
      case 'proc': {
        if (!need(1)) break;
        const t = codeLabel(ops[0]);
        if (t !== null) emit(encB(OP.PROC, 0, 0, 0, t), st);
        break;
      }
    }
    // keep addresses aligned even after an error, so later diagnostics point at the right line
    const wanted = SIZE_TWO.has(st.op ?? '') ? 2 : 1;
    while (code.length < before + wanted) {
      code.push(0);
      lineOf.push(line);
      listing.push({ addr: code.length - 1, word: 0, line, text: st.text });
    }
  }

  // ---- entry point -------------------------------------------------------------------------
  let entry = 0;
  const entrySym = entryName !== null ? syms.get(entryName) : syms.get('start');
  if (entryName !== null) {
    if (!entrySym || entrySym.kind !== 'code') err(entryLine, `.entry "${entryName}" is not a code label`);
    else entry = entrySym.value;
  } else if (entrySym && entrySym.kind === 'code') {
    entry = entrySym.value;
  }

  const symbols: SymbolInfo[] = [];
  for (const [name, s] of syms) {
    if (s.kind !== 'equ' && name[0] !== '$') symbols.push({ name, kind: s.kind, addr: s.value, line: s.line });
  }
  symbols.sort((a, b) => a.addr - b.addr || a.name.localeCompare(b.name));

  const sourceMap: SourceMap = {
    version: 1,
    files: [fileName],
    code: lineOf.map((l, addr) => [addr, 0, l] as [number, number, number]),
    labels: symbols.map((s) => ({ name: s.name, kind: s.kind, addr: s.addr })),
  };

  const hasErrors = (): boolean => diagnostics.some((d) => d.severity === 'error');
  if (!hasErrors()) {
    for (const d of checkProgram(code, entry, lineOf)) diagnostics.push(d);
  }
  // Report in source order: line by line, errors before warnings, and non-line diagnostics last.
  const rank = (d: Diagnostic): number => (d.line === 0 ? Number.MAX_SAFE_INTEGER : d.line);
  diagnostics.sort((a, b) => rank(a) - rank(b) || (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
  const ok = !hasErrors();
  const result: AssembleResult = { ok, entry, code, data, diagnostics, listing, symbols, sourceMap };
  if (ok) result.image = buildImage(entry, code, data, symbols);
  return result;
}
