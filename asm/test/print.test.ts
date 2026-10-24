import { describe, expect, it } from 'vitest';

import { assemble } from '../src/index.js';

const errors = (src: string): string[] => assemble(src).diagnostics.filter((d) => d.severity === 'error').map((d) => d.message);
const size = (body: string): number => assemble(`start: nop\n${body}\n hlt\n`).code.length - 2; // instructions the macro produced
const base = String.raw;

describe('.print: what it expands to', () => {
  it('one constant character is 13 instructions, a register value costs a little more with a tag', () => {
    expect(size(`.print 'H', r10, r11`)).toBe(13);
    expect(size(`.print r1, char, r10, r11`)).toBe(11); // no tag word to write
    expect(size(`.print r1, unsigned, r10, r11`)).toBe(14);
    expect(size(`.print r1, signed, r10, r11`)).toBe(14);
    expect(size(`.print r1, hex, r10, r11`)).toBe(14);
  });
  it('a string is one entry per character', () => {
    expect(size(`.print "Hello", r10, r11`)).toBe(5 * 13);
    expect(size(base`.print "a\n", r10, r11`)).toBe(2 * 13);
  });
  it('a constant zero writes no value word', () => {
    expect(size(`.print 0, unsigned, r10, r11`)).toBeLessThan(size(`.print 1, unsigned, r10, r11`));
  });
  it('assembles without diagnostics and keeps user labels on the macro line', () => {
    const r = assemble('start: nop\nhere: .print "ok", r10, r11\nafter: hlt\n');
    expect(r.diagnostics).toEqual([]);
    expect(r.symbols.find((s) => s.name === 'here')!.addr).toBe(1);
  });
  it('commas and semicolons inside a string are part of it', () => {
    const r = assemble('start: nop\n .print "a, b; c", r10, r11 ; a real comment\n hlt\n');
    expect(r.diagnostics).toEqual([]);
    expect(r.code.length).toBe(2 + 7 * 13); // seven characters: a , space b ; space c
  });
});

describe('.print: mistakes are reported', () => {
  it('a register needs a format', () => expect(errors('.print r1, r10, r11\n hlt\n').join()).toMatch(/needs a format/));
  it('unknown format', () => expect(errors('.print r1, binary, r10, r11\n hlt\n').join()).toMatch(/unknown format "binary"/));
  it('wrong number of operands', () => expect(errors('.print "x"\n hlt\n').join()).toMatch(/\.print takes/));
  it('scratch registers must be registers, different, and not r0', () => {
    expect(errors('.print "x", 5, r11\n hlt\n').join()).toMatch(/scratch registers/);
    expect(errors('.print "x", r10, r10\n hlt\n').join()).toMatch(/two different scratch/);
    expect(errors('.print "x", r0, r11\n hlt\n').join()).toMatch(/two different scratch/);
  });
  it('the value register must not be a scratch register', () => {
    expect(errors('.print r10, hex, r10, r11\n hlt\n').join()).toMatch(/differ from the scratch/);
  });
  it('a bad string escape', () => {
    expect(errors(base`.print "a\q", r10, r11` + '\n hlt\n').join()).toMatch(/unknown escape/);
  });
});
