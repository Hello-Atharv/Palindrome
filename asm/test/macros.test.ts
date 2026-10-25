import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { assemble } from '../src/index.js';

const example = (name: string): string => readFileSync(new URL(`../../examples/asm/${name}`, import.meta.url), 'utf8');
const errors = (src: string): string[] =>
  assemble(src).diagnostics.filter((d) => d.severity === 'error').map((d) => d.message);
const has = (src: string, re: RegExp): boolean => errors(src).some((m) => re.test(m));

describe('macros expand to exactly the hand-written code', () => {
  it('.if/.else/.fi equals ifelse.s', () => {
    const macro = assemble(example('ifelse_macro.s'));
    expect(macro.diagnostics).toEqual([]);
    expect(macro.code).toEqual(assemble(example('ifelse.s')).code);
  });
  it('.loop/.again equals loop.s', () => {
    const macro = assemble(example('loop_macro.s'));
    expect(macro.diagnostics).toEqual([]);
    expect(macro.code).toEqual(assemble(example('loop.s')).code);
  });
  it('nested macros assemble without diagnostics', () => {
    const r = assemble(example('nested.s'));
    expect(r.diagnostics).toEqual([]);
    expect(r.ok).toBe(true);
  });
});

describe('macro details', () => {
  it('an .if without .else leaves the else side empty', () => {
    const r = assemble('start: addi r1, 1\n addi r2, 1\n .if eq, r1, r2\n addi r3, 5\n .fi ne, r1, r2\n hlt\n');
    expect(r.diagnostics).toEqual([]);
    // addi, addi, br eq, br al, lnd al, addi, lnd ne, hlt
    expect(r.code.length).toBe(8);
  });
  it('generated labels are hidden, user labels on macro lines are kept', () => {
    const r = assemble('start: nop\nhere: .if al, r0, r0\n nop\n.fi ne, r0, r0\nafter:\n hlt\n');
    expect(r.symbols.map((s) => s.name).sort()).toEqual(['after', 'here', 'start']);
    expect(r.symbols.find((s) => s.name === 'here')!.addr).toBe(1); // the generated br
    expect(r.symbols.find((s) => s.name === 'after')!.addr).toBe(r.code.length - 1);
  });
  it('listing and source map point generated code at the macro line', () => {
    const r = assemble('start: nop\n .if al, r0, r0\n nop\n .fi ne, r0, r0\n hlt\n');
    const lines = r.listing.map((l) => l.line);
    expect(lines[1]).toBe(2); // br from .if
    expect(lines[lines.length - 2]).toBe(4); // landing from .fi
  });
  it('user labels may not start with $', () => {
    expect(has('$mine: nop\n hlt', /reserved/)).toBe(true);
  });
});

describe('macro errors', () => {
  it('reports unmatched and unclosed macros with the right line', () => {
    expect(has('start: hlt\n .else\n', /\.else without/)).toBe(true);
    expect(has('start: hlt\n .fi ne, r0, r0\n', /\.fi without/)).toBe(true);
    expect(has('start: hlt\n .again ne, r0, r0\n', /\.again without/)).toBe(true);
    const open = assemble('start: nop\n .if eq, r1, r2\n nop\n hlt\n');
    const e = open.diagnostics.find((d) => d.severity === 'error')!;
    expect(e.line).toBe(2);
    expect(e.message).toMatch(/never closed/);
    expect(has('start: nop\n .loop ne, r1, r2\n nop\n hlt\n', /never closed/)).toBe(true);
  });
  it('rejects mismatched closers, a second .else, and bad operand counts', () => {
    expect(has('start: nop\n .loop ne, r1, r2\n .fi ne, r1, r2\n hlt', /\.fi without/)).toBe(true);
    expect(has('start: nop\n .if eq, r1, r2\n .else\n .else\n .fi ne, r1, r2\n hlt', /second \.else/)).toBe(true);
    expect(has('start: nop\n .if eq, r1\n .fi ne, r1, r2\n hlt', /takes "cc, ra, rb"/)).toBe(true);
    expect(has('start: nop\n .if eq, r1, r2\n .fi ne\n hlt', /takes "cc, ra, rb"/)).toBe(true);
  });
  it('a program that starts with .loop puts an lnd at the entry and is rejected', () => {
    expect(has('.loop ne, r2, r0\n addi r2, 1\n .again ne, r2, r1\n hlt\n', /entry point must not be a jump target/)).toBe(true);
  });
});
