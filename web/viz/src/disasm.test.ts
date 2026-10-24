import { describe, expect, it } from 'vitest';
import { Op } from '../../../spec/vm_api';
import { disassemble } from './disasm';

const w = (op: Op, ra = 0, rb = 0, low = 0): number => ((op << 26) | (ra << 22) | (rb << 18) | low) >>> 0;
const text = (word: number, labels?: Map<number, string>): string => {
  const d = disassemble(word, labels);
  return d.operands ? `${d.mnemonic} ${d.operands}` : d.mnemonic;
};

describe('disassemble', () => {
  it('prints register and immediate forms in asm_syntax.md style', () => {
    expect(text(w(Op.NOP))).toBe('nop');
    expect(text(w(Op.ADD, 1, 2))).toBe('add r1, r2');
    expect(text(w(Op.ADDI, 3, 0, 0x3fffb))).toBe('addi r3, -5');
    expect(text(w(Op.XORI, 1, 0, 0x20000))).toBe('xori r1, 0x20000');
    expect(text(w(Op.NOT, 14))).toBe('not sp');
    expect(text(w(Op.ROLI, 2, 0, 33))).toBe('roli r2, 1');
  });

  it('prints memory operands with signed offsets', () => {
    expect(text(w(Op.XLD, 4, 1, 0))).toBe('xld r4, [r1]');
    expect(text(w(Op.XST, 4, 1, 3))).toBe('xst r4, [r1+3]');
    expect(text(w(Op.XLD, 4, 1, 0x3fffc))).toBe('xld r4, [r1-4]');
  });

  it('puts rc first for CSWAP and last for TOFF', () => {
    const rc = 7 << 14;
    expect(text(w(Op.CSWAP, 1, 2, rc))).toBe('cswap r7, r1, r2');
    expect(text(w(Op.TOFF, 1, 2, rc))).toBe('toff r1, r2, r7');
  });

  it('resolves branch targets to labels, falling back to addresses', () => {
    const labels = new Map([[5, 'Lthen']]);
    expect(text(w(Op.BR, 1, 2, (1 << 16) | 5), labels)).toBe('br eq, r1, r2, Lthen');
    expect(text(w(Op.BR, 0, 0, 9), labels)).toBe('br al, @0x9');
    expect(text(w(Op.LND, 0, 0, 5), labels)).toBe('lnd al, r0, r0, Lthen');
    expect(text(w(Op.CALL, 0, 0, 5), labels)).toBe('call Lthen');
    expect(text(w(Op.PROC, 0, 0, 5), labels)).toBe('proc Lthen');
  });

  it('shows undefined opcodes as raw words', () => {
    expect(text(0xfc000000)).toBe('.word 0xfc000000');
  });
});
