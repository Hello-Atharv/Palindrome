/** Instruction word encoder/decoder (SPEC.md section 3). */
import { Op } from '../../../spec/vm_api';

export const IMM_MIN = -(1 << 17);
export const IMM_MAX = (1 << 17) - 1;
export const IMMZ_MAX = (1 << 18) - 1;
export const OP_MAX = Op.RET;

export interface Instr {
  op: Op;
  ra: number;
  rb: number;
  /** 3-register ops only (CSWAP, TOFF): bits [17:14]. */
  rc: number;
  /** sign-extended imm18 */
  imm: number;
  /** zero-extended imm18 (XORI) */
  immz: number;
  /** condition code, format B */
  cc: number;
  /** code address, format B */
  target: number;
}

/** Ops that use format B (cc[17:16] target16[15:0]). PROC stores its RET address E in target. */
export const isFormatB = (op: Op): boolean =>
  op === Op.BR || op === Op.LND || op === Op.CALL || op === Op.PROC;
const isThreeReg = (op: Op): boolean => op === Op.CSWAP || op === Op.TOFF;

export function decode(w: number): Instr {
  const raw = w & 0x3ffff;
  return {
    op: (w >>> 26) as Op,
    ra: (w >>> 22) & 15,
    rb: (w >>> 18) & 15,
    rc: (w >>> 14) & 15,
    imm: (raw << 14) >> 14,
    immz: raw,
    cc: (w >>> 16) & 3,
    target: w & 0xffff,
  };
}

export type InstrFields = Partial<Omit<Instr, 'op' | 'immz'>> & { op: Op };

function field(name: string, v: number, max: number): number {
  if (!Number.isInteger(v) || v < 0 || v > max) throw new RangeError(`${name}=${v} out of range 0..${max}`);
  return v;
}

/** Encode an instruction. XORI takes `imm` as 0..262143; every other imm op takes -131072..131071. */
export function encode(i: InstrFields): number {
  if (!Number.isInteger(i.op) || i.op < 0 || i.op > OP_MAX) throw new RangeError(`bad op ${i.op}`);
  const ra = field('ra', i.ra ?? 0, 15);
  const rb = field('rb', i.rb ?? 0, 15);
  let low: number;
  if (isFormatB(i.op)) {
    low = (field('cc', i.cc ?? 0, 3) << 16) | field('target', i.target ?? 0, 0xffff);
  } else if (isThreeReg(i.op)) {
    low = field('rc', i.rc ?? 0, 15) << 14;
  } else {
    const imm = i.imm ?? 0;
    const lo = i.op === Op.XORI ? 0 : IMM_MIN;
    const hi = i.op === Op.XORI ? IMMZ_MAX : IMM_MAX;
    if (!Number.isInteger(imm) || imm < lo || imm > hi) throw new RangeError(`imm=${imm} out of range ${lo}..${hi}`);
    low = imm & 0x3ffff;
  }
  return ((i.op << 26) | (ra << 22) | (rb << 18) | low) >>> 0;
}

export const MNEMONIC: readonly string[] = [
  'nop', 'hlt', 'add', 'sub', 'addi', 'xor', 'xori', 'not', 'swap', 'roli',
  'xld', 'xst', 'cswap', 'toff', 'br', 'lnd', 'call', 'proc', 'ret',
];
