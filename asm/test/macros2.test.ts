// .with, .compute / .use / .uncompute and .plot
import { describe, expect, it } from 'vitest';

import { assemble } from '../src/index.js';
import { constantOps } from '../src/macros.js';

const errors = (src: string): string[] =>
  assemble(src).diagnostics.filter((d) => d.severity === 'error').map((d) => d.message);
const has = (src: string, re: RegExp): boolean => errors(src).some((m) => re.test(m));
/** The instructions the assembler emitted, as "op operands" text, from the listing (generated text is "op a, b    ; note"). */
const ops = (src: string): string[] =>
  assemble(src).listing.map((r) => r.text.replace(/^[\w.$]+:\s*/, '').split(';')[0].trim().replace(/\s+/g, ' '));
const lcg = (s: { v: number }): number => ((s.v = (Math.imul(s.v, 1664525) + 1013904223) >>> 0), s.v);

describe('.with: a constant in a register, cleared afterwards', () => {
  it('builds every 32-bit value correctly and the clearing sequence undoes it', () => {
    const rotl = (x: number, k: number): number => ((x << k) | (x >>> (32 - k))) >>> 0;
    const apply = (reg: number, steps: [string, number][]): number =>
      steps.reduce((r, [m, v]) => (m === 'xori' ? (r ^ v) >>> 0 : rotl(r, v)), reg);
    const st = { v: 7 };
    const samples = [0, 1, 63, 0x3ffff, 0x40000, 0xffff, 0xffffff, 0x80000000, 0xffffffff, 1 << 27, 45 << 20, ...Array.from({ length: 300 }, () => lcg(st))];
    for (const v of samples) {
      const built = constantOps(v);
      expect(built.length).toBeLessThanOrEqual(3);
      expect(apply(0, built)).toBe(v >>> 0);
      const undo = [...built].reverse().map(([m, x]): [string, number] => [m, m === 'roli' ? (32 - x) % 32 : x]);
      expect(apply(v >>> 0, undo)).toBe(0);
    }
  });

  it('expands to build, body, clear', () => {
    expect(ops('start: nop\n .with r11, 63\n add r1, r11\n .endwith\n hlt')).toEqual(
      ['nop', 'xori r11, 63', 'add r1, r11', 'xori r11, 63', 'hlt']);
    expect(ops('.equ K, 0xFFFFFF\nstart: nop\n .with r11, K\n .endwith\n hlt')).toHaveLength(8); // nop, 3 build, 3 clear, hlt
  });

  it('rejects a body that changes the constant, a non-constant, and a missing .endwith', () => {
    expect(has('start: nop\n .with r11, 5\n addi r11, 1\n .endwith\n hlt', /holding as a constant/)).toBe(true);
    expect(has('start: nop\n .with r11, nope\n .endwith\n hlt', /must be a constant/)).toBe(true);
    expect(has('start: nop\n .with r11, 5\n hlt', /never closed/)).toBe(true);
    expect(has('start: nop\n .endwith\n hlt', /without a matching/)).toBe(true);
  });
});

describe('.compute / .use / .uncompute: the undo is written for you', () => {
  it('emits the exact inverse of the compute block, in reverse order', () => {
    const src = `start: nop
 .compute
 xor r2, r1
 roli r2, 3
 addi r2, 7
 add r2, r3
 .use
 xst r2, [r4+0]
 .uncompute
 hlt`;
    expect(ops(src)).toEqual([
      'nop',
      'xor r2, r1', 'roli r2, 3', 'addi r2, 7', 'add r2, r3',
      'xst r2, [r4+0]',
      'sub r2, r3', 'subi r2, 7', 'roli r2, 29', 'xor r2, r1',
      'hlt',
    ]);
  });

  it('undoes neg as subi 1 then not', () => {
    const src = `start: nop
 .compute
 neg r2
 .use
 xst r2, [r4+0]
 .uncompute
 hlt`;
    const text = ops(src);
    expect(text.slice(-3)).toEqual(['subi r2, 1', 'not r2', 'hlt']);
  });

  it('refuses a use block that changes an input of the compute block', () => {
    expect(has('start: nop\n .compute\n xor r2, r1\n .use\n addi r1, 1\n .uncompute\n hlt', /changes r1, which the \.compute block only reads/)).toBe(true);
    // changing something the compute block wrote is allowed (temporaries may be reused)
    expect(errors('start: nop\n .compute\n xor r2, r1\n .use\n xori r2, 1\n .uncompute\n hlt')).toEqual([]);
  });

  it('refuses branches and labels inside the compute block', () => {
    expect(has('start: nop\n .compute\n .if eq, r1, r2\n xori r3, 1\n .fi ne, r1, r2\n .use\n nop\n .uncompute\n hlt', /cannot be undone automatically/)).toBe(true);
    expect(has('start: nop\n .compute\nhere: xor r2, r1\n .use\n nop\n .uncompute\n hlt', /label inside a \.compute/)).toBe(true);
    expect(has('start: nop\n .compute\n roli r2, nope\n .use\n nop\n .uncompute\n hlt', /constant count/)).toBe(true);
  });

  it('reports a missing .use, a missing .uncompute and stray keywords', () => {
    expect(has('start: nop\n .compute\n xor r2, r1\n .uncompute\n hlt', /needs a \.use block/)).toBe(true);
    expect(has('start: nop\n .compute\n xor r2, r1\n .use\n nop\n hlt', /never closed/)).toBe(true);
    expect(has('start: nop\n .use\n hlt', /without a matching/)).toBe(true);
    expect(has('start: nop\n .uncompute\n hlt', /without a matching/)).toBe(true);
  });

  it('nests, and works together with .with and .if inside the use block', () => {
    const src = `start: nop
 .with r11, 100
 .compute
 xor r2, r1
 add r2, r11
 .use
   .compute
   xor r3, r2
   .use
   xst r3, [r4+0]
   .uncompute
 .uncompute
 .endwith
 hlt`;
    expect(errors(src)).toEqual([]);
  });
});

describe('.plot', () => {
  it('expands to address, xor the pixel, undo the address', () => {
    expect(ops('start: nop\n .plot r5, r6, r7, r10\n hlt')).toEqual([
      'nop', 'xor r10, r7', 'roli r10, 6', 'add r10, r6', 'xori r10, 0x20000', 'xst r5, [r10+0]',
      'xori r10, 0x20000', 'sub r10, r6', 'roli r10, 26', 'xor r10, r7', 'hlt']);
  });
  it('needs four different registers', () => {
    expect(has('start: nop\n .plot r5, r6, r7\n hlt', /takes "colour, x, y, tmp"/)).toBe(true);
    expect(has('start: nop\n .plot r5, r6, r7, r5\n hlt', /four different registers/)).toBe(true);
    expect(has('start: nop\n .plot r5, 3, r7, r10\n hlt', /must be registers/)).toBe(true);
  });
});
