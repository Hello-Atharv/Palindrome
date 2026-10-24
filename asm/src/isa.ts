// Opcodes, condition codes and instruction encoding (spec/SPEC.md sections 3-4).

export const OP = {
  NOP: 0, HLT: 1, ADD: 2, SUB: 3, ADDI: 4, XOR: 5, XORI: 6, NOT: 7, SWAP: 8, ROLI: 9,
  XLD: 10, XST: 11, CSWAP: 12, TOFF: 13, BR: 14, LND: 15, CALL: 16, PROC: 17, RET: 18,
} as const;

export const COND = { al: 0, eq: 1, ne: 2, lt: 3 } as const;
export type CondName = keyof typeof COND;

export const MAX_CODE_WORDS = 65536;
export const MAX_DATA_WORDS = 65536;
export const SIMM18_MIN = -131072;
export const SIMM18_MAX = 131071;
export const UIMM18_MAX = 262143;

/** Format R: op[31:26] ra[25:22] rb[21:18] imm18[17:0]. */
export function encR(op: number, ra: number, rb: number, imm18: number): number {
  return ((op << 26) | (ra << 22) | (rb << 18) | (imm18 & 0x3ffff)) >>> 0;
}

/** Three-register format: op ra rb rc[17:14]. */
export function encRRR(op: number, ra: number, rb: number, rc: number): number {
  return ((op << 26) | (ra << 22) | (rb << 18) | (rc << 14)) >>> 0;
}

/** Format B: op ra rb cc[17:16] target16[15:0]. */
export function encB(op: number, ra: number, rb: number, cc: number, target: number): number {
  return ((op << 26) | (ra << 22) | (rb << 18) | (cc << 16) | (target & 0xffff)) >>> 0;
}

export interface Decoded {
  op: number;
  ra: number;
  rb: number;
  rc: number;
  cc: number;
  target: number;
}

export function decode(word: number): Decoded {
  return {
    op: word >>> 26,
    ra: (word >>> 22) & 15,
    rb: (word >>> 18) & 15,
    rc: (word >>> 14) & 15,
    cc: (word >>> 16) & 3,
    target: word & 0xffff,
  };
}
