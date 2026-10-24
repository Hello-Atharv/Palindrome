/**
 * Disassembler for the 32-bit words of SPEC.md section 3, written against the Op enum in spec/vm_api.ts.
 * (Deliberately independent of web/mock_vm: the real VM replaces the mock, the UI must not notice.)
 * Output follows spec/asm_syntax.md.
 */
import { COND, Op } from '../../../spec/vm_api';

export interface Disasm {
  mnemonic: string;
  operands: string;
}

const reg = (n: number): string => (n === 14 ? 'sp' : `r${n}`);
const sext18 = (w: number): number => ((w & 0x3ffff) << 14) >> 14;
const num = (v: number): string => (Math.abs(v) >= 256 ? `${v < 0 ? '-' : ''}0x${Math.abs(v).toString(16)}` : String(v));

function mem(rb: number, imm: number): string {
  return imm === 0 ? `[${reg(rb)}]` : `[${reg(rb)}${imm < 0 ? '-' : '+'}${num(Math.abs(imm))}]`;
}

/** `labels` maps code addresses to names (from the .rvm symbol table). */
export function disassemble(word: number, labels?: ReadonlyMap<number, string>): Disasm {
  const op = (word >>> 26) as Op;
  const ra = (word >>> 22) & 15;
  const rb = (word >>> 18) & 15;
  const rc = (word >>> 14) & 15;
  const cc = COND[(word >>> 16) & 3];
  const target = word & 0xffff;
  const imm = sext18(word);
  const at = labels?.get(target) ?? `@0x${target.toString(16)}`;
  const m = (mnemonic: string, operands = ''): Disasm => ({ mnemonic, operands });

  switch (op) {
    case Op.NOP: return m('nop');
    case Op.HLT: return m('hlt');
    case Op.ADD: return m('add', `${reg(ra)}, ${reg(rb)}`);
    case Op.SUB: return m('sub', `${reg(ra)}, ${reg(rb)}`);
    case Op.ADDI: return m('addi', `${reg(ra)}, ${num(imm)}`);
    case Op.XOR: return m('xor', `${reg(ra)}, ${reg(rb)}`);
    case Op.XORI: return m('xori', `${reg(ra)}, ${num(word & 0x3ffff)}`);
    case Op.NOT: return m('not', reg(ra));
    case Op.SWAP: return m('swap', `${reg(ra)}, ${reg(rb)}`);
    case Op.ROLI: return m('roli', `${reg(ra)}, ${imm & 31}`);
    case Op.XLD: return m('xld', `${reg(ra)}, ${mem(rb, imm)}`);
    case Op.XST: return m('xst', `${reg(ra)}, ${mem(rb, imm)}`);
    case Op.CSWAP: return m('cswap', `${reg(rc)}, ${reg(ra)}, ${reg(rb)}`);
    case Op.TOFF: return m('toff', `${reg(ra)}, ${reg(rb)}, ${reg(rc)}`);
    case Op.BR: return m('br', cc === 'al' ? `al, ${at}` : `${cc}, ${reg(ra)}, ${reg(rb)}, ${at}`);
    case Op.LND: return m('lnd', `${cc}, ${reg(ra)}, ${reg(rb)}, ${at}`);
    case Op.CALL: return m('call', at);
    case Op.PROC: return m('proc', at);
    case Op.RET: return m('ret');
    default: return m('.word', `0x${(word >>> 0).toString(16).padStart(8, '0')}`);
  }
}
