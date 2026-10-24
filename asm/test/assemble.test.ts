import { describe, expect, it } from 'vitest';

import { assemble } from '../src/index.js';
import { evalExpr } from '../src/expr.js';
import { parse } from '../src/parser.js';

const errors = (src: string): string[] =>
  assemble(src).diagnostics.filter((d) => d.severity === 'error').map((d) => d.message);

/** Wrap a body so the control-flow checks pass: start, body, hlt. */
const prog = (body: string): string => `start: ${body}\n hlt\n`;

describe('expressions', () => {
  const lookup = (n: string): number | undefined => ({ FB: 0x20000, K: 4 })[n as 'FB' | 'K'];
  it('evaluates numbers, symbols, + - and parentheses', () => {
    expect(evalExpr('0x10', lookup)).toEqual({ ok: true, value: 16 });
    expect(evalExpr('FB + K*1', lookup).ok).toBe(false); // * is not supported
    expect(evalExpr('FB+K', lookup)).toEqual({ ok: true, value: 0x20004 });
    expect(evalExpr('-(K-10)', lookup)).toEqual({ ok: true, value: 6 });
    expect(evalExpr("'A'", lookup)).toEqual({ ok: true, value: 65 });
    expect(evalExpr('0b101', lookup)).toEqual({ ok: true, value: 5 });
  });
  it('reports undefined symbols and junk', () => {
    expect(evalExpr('nope', lookup)).toEqual({ ok: false, error: 'undefined symbol "nope"' });
    expect(evalExpr('', lookup).ok).toBe(false);
    expect(evalExpr('(1', lookup).ok).toBe(false);
  });
});

describe('parser', () => {
  it('handles labels, comments, multiple labels and operand splitting', () => {
    const { stmts } = parse('a: b: addi r1, 5 ; comment\n\n; only comment\nc:\n xld r1, [r2 + 3]\n');
    expect(stmts.map((s) => [s.labels, s.op, s.operands])).toEqual([
      [['a', 'b'], 'addi', ['r1', '5']],
      [['c'], null, []],
      [[], 'xld', ['r1', '[r2 + 3]']],
    ]);
    expect(stmts[0].line).toBe(1);
    expect(stmts[2].line).toBe(5);
  });
  it('rejects empty operands', () => {
    expect(parse('add r1,,r2').diagnostics.length).toBe(1);
  });
});

describe('encoding', () => {
  // op[31:26] ra[25:22] rb[21:18] imm18, worked out by hand.
  it('encodes addi r1, 5 as 0x10400005', () => {
    expect(assemble(prog('addi r1, 5')).code[0]).toBe(0x10400005);
  });
  it('encodes the register and immediate forms', () => {
    const r = assemble(prog(`
      add r1, r2
      sub r3, r4
      xor r5, r6
      xori r7, 0x3ffff
      not r8
      swap r1, r2
      roli r3, 31
      addi r1, -1
      nop`));
    expect(r.ok).toBe(true);
    expect(r.code.slice(0, 9)).toEqual([
      (2 << 26) | (1 << 22) | (2 << 18),
      (3 << 26) | (3 << 22) | (4 << 18),
      (5 << 26) | (5 << 22) | (6 << 18),
      ((6 << 26) | (7 << 22) | 0x3ffff) >>> 0,
      (7 << 26) | (8 << 22),
      (8 << 26) | (1 << 22) | (2 << 18),
      (9 << 26) | (3 << 22) | 31,
      ((4 << 26) | (1 << 22) | 0x3ffff) >>> 0,
      0,
    ]);
  });
  it('encodes memory operands, with and without offsets and with sp', () => {
    const r = assemble(prog('xld r1, [r2]\n xst r3, [sp-2]\n xld r4, [r5+ 0x10]'));
    expect(r.code.slice(0, 3)).toEqual([
      (10 << 26) | (1 << 22) | (2 << 18),
      ((11 << 26) | (3 << 22) | (14 << 18) | 0x3fffe) >>> 0,
      (10 << 26) | (4 << 22) | (5 << 18) | 0x10,
    ]);
  });
  it('encodes the three-register ops with rc in bits 17:14', () => {
    const r = assemble(prog('cswap r1, r2, r3\n toff r4, r5, r6'));
    expect(r.code.slice(0, 2)).toEqual([
      (12 << 26) | (2 << 22) | (3 << 18) | (1 << 14),
      (13 << 26) | (4 << 22) | (5 << 18) | (6 << 14),
    ]);
  });
  it('expands pseudo-ops: subi and neg', () => {
    const r = assemble(prog('subi r1, 5\n neg r2'));
    expect(r.code.slice(0, 3)).toEqual([
      ((4 << 26) | (1 << 22) | ((-5) & 0x3ffff)) >>> 0,
      (7 << 26) | (2 << 22),
      (4 << 26) | (2 << 22) | 1,
    ]);
  });
  it('is case-insensitive for mnemonics and registers, not labels', () => {
    expect(assemble(prog('ADDI R1, 5')).code[0]).toBe(0x10400005);
  });
});

describe('data and constants', () => {
  it('lays out .data, .word, .space and resolves data labels and .equ', () => {
    const r = assemble(`
      .equ FB, 0x20000
      .data
msg:  .word 1, 0xFFFFFFFF, -1
pad:  .space 2
tail: .word FB
      .code
start: addi r1, tail
       xori r2, FB
       hlt`);
    expect(r.ok).toBe(true);
    expect(r.data).toEqual([1, 0xffffffff, 0xffffffff, 0, 0, 0x20000]);
    expect(r.code[0]).toBe(((4 << 26) | (1 << 22) | 5) >>> 0); // tail = data address 5
    expect(r.code[1]).toBe(((6 << 26) | (2 << 22) | 0x20000) >>> 0);
    expect(r.symbols.map((s) => [s.name, s.kind, s.addr])).toEqual([
      ['msg', 'data', 0], ['start', 'code', 0], ['pad', 'data', 3], ['tail', 'data', 5],
    ]);
  });
});

describe('image and maps', () => {
  it('writes the header, code, data and symbol table little-endian', () => {
    const r = assemble('.data\nd: .word 7\n.code\nstart: nop\n hlt\n');
    const img = r.image!;
    const v = new DataView(img.buffer, img.byteOffset, img.byteLength);
    expect([0, 1, 2, 3, 4].map((k) => v.getUint32(4 * k, true))).toEqual([0x314d5652, 1, 0, 2, 1]);
    expect(v.getUint32(20, true)).toBe(img.length - 32 - 4 * 3); // sym_len
    expect(v.getUint32(32 + 4, true)).toBe(1 << 26); // second code word = hlt
    expect(v.getUint32(32 + 8, true)).toBe(7); // data word
    const sym = Array.from(img.slice(32 + 12));
    expect(sym).toEqual([0, 0, 0, 0, 1, 1, 100, 0, 0, 0, 0, 0, 5, 115, 116, 97, 114, 116]); // d (data), start (code)
  });
  it('builds a listing and a source map', () => {
    const r = assemble('; hi\nstart: nop\n\n hlt\n', { fileName: 'x.s' });
    expect(r.listing.map((l) => [l.addr, l.line])).toEqual([[0, 2], [1, 4]]);
    expect(r.sourceMap).toEqual({
      version: 1,
      files: ['x.s'],
      code: [[0, 0, 2], [1, 0, 4]],
      labels: [{ name: 'start', kind: 'code', addr: 0 }],
    });
  });
  it('uses .entry or start for the entry point', () => {
    expect(assemble('nop\nmain: nop\n hlt\n.entry main').entry).toBe(1);
    expect(assemble('nop\nstart: nop\n hlt').entry).toBe(1);
    expect(assemble('nop\n hlt').entry).toBe(0);
  });
});

describe('operand errors', () => {
  it('rejects equal registers where the op would not be reversible', () => {
    expect(errors(prog('add r1, r1'))[0]).toMatch(/different registers/);
    expect(errors(prog('xor r2, r2'))[0]).toMatch(/different registers/);
    expect(errors(prog('xld r1, [r1+0]'))[0]).toMatch(/different/);
    expect(errors(prog('cswap r1, r1, r2'))[0]).toMatch(/control register/);
    expect(errors(prog('toff r1, r1, r2'))[0]).toMatch(/target register/);
    expect(errors(prog('toff r1, r2, r1'))[0]).toMatch(/target register/);
  });
  it('warns, but accepts, swap of a register with itself', () => {
    const r = assemble(prog('swap r1, r1'));
    expect(r.ok).toBe(true);
    expect(r.diagnostics.some((d) => d.severity === 'warning' && /swap/.test(d.message))).toBe(true);
  });
  it('checks immediate ranges', () => {
    expect(errors(prog('addi r1, 131072'))[0]).toMatch(/out of range/);
    expect(errors(prog('addi r1, -131073'))[0]).toMatch(/out of range/);
    expect(assemble(prog('addi r1, -131072')).ok).toBe(true);
    expect(errors(prog('xori r1, -1'))[0]).toMatch(/out of range/);
    expect(errors(prog('xori r1, 262144'))[0]).toMatch(/out of range/);
    expect(errors(prog('roli r1, 32'))[0]).toMatch(/rotate count/);
    expect(errors(prog('xld r1, [r2+131072]'))[0]).toMatch(/offset/);
  });
  it('reports bad registers, operand counts, unknown things, with line numbers', () => {
    expect(errors(prog('add r1, r16'))[0]).toMatch(/expected a register/);
    expect(errors(prog('add r1'))[0]).toMatch(/takes 2 operands/);
    expect(errors(prog('frob r1'))[0]).toMatch(/unknown instruction/);
    expect(errors(prog('addi r1, nope'))[0]).toMatch(/undefined symbol/);
    expect(errors(prog('xld r1, r2'))[0]).toMatch(/memory operand/);
    expect(errors('.bogus 1\n hlt')[0]).toMatch(/unknown directive/);
    const r = assemble('start: nop\n add r1, r1\n hlt\n');
    expect(r.diagnostics.find((d) => d.severity === 'error')!.line).toBe(2);
  });
  it('rejects duplicate and register-named labels and misplaced directives', () => {
    expect(errors('a: nop\na: hlt')[0]).toMatch(/already defined/);
    expect(errors('r1: nop\n hlt')[0]).toMatch(/register name/);
    expect(errors('.data\n nop\n.code\n hlt')[0]).toMatch(/only allowed in the \.code/);
    expect(errors('.word 1\n hlt')[0]).toMatch(/only allowed in the \.data/);
  });
  it('keeps addresses aligned after an error so later lines are still checked', () => {
    const errs = assemble('start: add r1, r1\n frob\n addi r1, 999999\n hlt\n').diagnostics.filter(
      (d) => d.severity === 'error',
    );
    expect(errs.map((e) => e.line)).toEqual([1, 2, 3]);
  });
});
