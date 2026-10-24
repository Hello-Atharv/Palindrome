import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { assemble } from '../src/index.js';

const errors = (src: string): string[] =>
  assemble(src).diagnostics.filter((d) => d.severity === 'error').map((d) => d.message);
const has = (src: string, re: RegExp): boolean => errors(src).some((m) => re.test(m));
const example = (name: string): string => readFileSync(new URL(`../examples/${name}`, import.meta.url), 'utf8');

describe('the shipped examples assemble cleanly', () => {
  for (const name of ['ifelse.s', 'loop.s', 'call.s', 'memory.s', 'ifelse_macro.s', 'loop_macro.s', 'nested.s', 'bennett.s']) {
    it(name, () => {
      const r = assemble(example(name), { fileName: name });
      expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(r.ok).toBe(true);
      expect(r.diagnostics).toEqual([]); // no warnings either
    });
  }
  it('lays out ifelse.s exactly like the VM test program', () => {
    const r = assemble(example('ifelse.s'));
    // addresses: 0 addi, 1 addi, 2 br eq (S0), 3 addi, 4 br al (S1), 5 lnd (Lthen), 6 addi, 7 lnd (Lend), 8 hlt
    expect(r.symbols.map((s) => [s.name, s.addr])).toEqual([
      ['start', 0], ['S0', 2], ['S1', 4], ['Lthen', 5], ['Lend', 7],
    ]);
    expect(r.code[2]).toBe(((14 << 26) | (1 << 22) | (2 << 18) | (1 << 16) | 5) >>> 0); // br eq r1,r2 -> 5
    expect(r.code[5]).toBe(((15 << 26) | 2) >>> 0); // lnd al, src 2
    expect(r.code[7]).toBe(((15 << 26) | (1 << 22) | (2 << 18) | (2 << 16) | 4) >>> 0); // lnd ne r1,r2, src 4
  });
});

describe('control-flow rules', () => {
  it('br must land on an lnd that names it', () => {
    expect(errors('start: br al, L\n nop\nL: nop\n hlt')[0]).toMatch(/must land on an lnd/);
    // lnd names the wrong branch
    expect(
      errors('start: br al, L\n nop\nL: lnd al, r0, r0, start2\nstart2: hlt')[0],
    ).toMatch(/lnd|br/);
  });
  it('an lnd must name a br that jumps to it', () => {
    expect(errors('start: nop\nL: lnd al, r0, r0, start\n hlt')[0]).toMatch(/lnd must name/);
  });
  it('call must target a proc, and every proc needs exactly one ret', () => {
    expect(errors('start: call f\n hlt\nf: nop\n ret')[0]).toMatch(/call target must be a proc/);
    expect(errors('start: call f\n hlt\nf: proc e\n nop\ne: nop\n ret')[0]).toMatch(/proc must name its ret/);
    expect(has('start: hlt\nf: proc e\n nop\ne: ret\ng: ret', /not the declared exit of any proc/)).toBe(true);
    expect(has('start: hlt\nf: proc e\n nop\ne: ret\ng: proc e\n nop', /more than one proc/)).toBe(true);
  });
  it('a proc cannot be entered by falling through', () => {
    expect(errors('start: nop\nf: proc e\ne: ret\n hlt')[0]).toMatch(/falling through/);
    expect(assemble('start: call f\n hlt\nf: proc e\ne: ret').ok).toBe(true); // right after a hlt: fine
  });
  it('code after hlt, ret or br al must be an lnd or proc', () => {
    expect(errors('start: hlt\n nop\n hlt')[0]).toMatch(/cannot be reached/);
    expect(errors('start: br al, L\n nop\nL: lnd al, r0, r0, start\n hlt')[0]).toMatch(/cannot be reached/);
  });
  it('the program must not run off the end, and the entry must not be a jump target', () => {
    expect(errors('start: nop')[0]).toMatch(/run off the end/);
    expect(errors('start: call f\n hlt\nf: proc e\ne: ret\n.entry f')[0]).toMatch(/entry point must not be a jump target/);
  });
  it('warns when there is no hlt', () => {
    const r = assemble('start: br al, L\nL: lnd al, r0, r0, start\n');
    expect(r.diagnostics.some((d) => d.severity === 'warning' && /no hlt/.test(d.message))).toBe(true);
  });
  it('does not run the control-flow checks when there are earlier errors', () => {
    const msgs = errors('start: add r1, r1\n nop');
    expect(msgs.length).toBe(1);
  });
});
