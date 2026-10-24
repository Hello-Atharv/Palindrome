import { describe, expect, it } from 'vitest';
import { Op } from '../../../spec/vm_api';
import { buildImage, parseImage } from '../src/image';
import { decode, encode } from '../src/isa';
import { Tape } from '../src/tape';
import { rng } from './helpers';

describe('instruction words', () => {
  it('round-trips every opcode with random operands', () => {
    const r = rng(1);
    const pick = (n: number) => Math.floor(r() * n);
    for (let op = Op.NOP; op <= Op.RET; op++) {
      for (let k = 0; k < 50; k++) {
        const imm = op === Op.XORI ? pick(262144) : pick(262144) - 131072;
        const i = { op, ra: pick(16), rb: pick(16), rc: pick(16), cc: pick(4), target: pick(65536), imm };
        const d = decode(encode(i));
        expect(d.op).toBe(op);
        expect(d.ra).toBe(i.ra);
        expect(d.rb).toBe(i.rb);
        if (op === Op.CSWAP || op === Op.TOFF) expect(d.rc).toBe(i.rc);
        else if (op === Op.BR || op === Op.LND || op === Op.CALL || op === Op.PROC) {
          expect(d.cc).toBe(i.cc);
          expect(d.target).toBe(i.target);
        } else if (op === Op.XORI) expect(d.immz).toBe(i.imm);
        else expect(d.imm).toBe(i.imm);
      }
    }
  });

  it('places fields at the spec bit positions', () => {
    // op[31:26] ra[25:22] rb[21:18] imm18[17:0]
    expect(encode({ op: Op.ADDI, ra: 3, rb: 0, imm: -1 })).toBe(((4 << 26) | (3 << 22) | 0x3ffff) >>> 0);
    // format B: cc[17:16] target16[15:0]
    expect(encode({ op: Op.BR, ra: 1, rb: 2, cc: 3, target: 0xabcd })).toBe(((14 << 26) | (1 << 22) | (2 << 18) | (3 << 16) | 0xabcd) >>> 0);
  });

  it('sign-extends imm18 except for XORI', () => {
    expect(decode(encode({ op: Op.ADDI, ra: 1, imm: -5 })).imm).toBe(-5);
    expect(decode(encode({ op: Op.XORI, ra: 1, imm: 0x3ffff })).immz).toBe(0x3ffff);
  });

  it('rejects out-of-range fields', () => {
    expect(() => encode({ op: Op.ADDI, ra: 1, imm: 131072 })).toThrow(RangeError);
    expect(() => encode({ op: Op.XORI, ra: 1, imm: -1 })).toThrow(RangeError);
    expect(() => encode({ op: Op.NOT, ra: 16 })).toThrow(RangeError);
    expect(() => encode({ op: Op.BR, target: 65536 })).toThrow(RangeError);
  });
});

describe('.rvm images', () => {
  const code = [encode({ op: Op.NOP }), encode({ op: Op.HLT })];

  it('round-trips code, data and symbols', () => {
    const img = buildImage({ entry: 1, code, data: [7, 0xffffffff], symbols: [{ addr: 1, kind: 0, name: 'start' }] });
    const r = parseImage(img);
    if (!r.ok) throw new Error(r.error);
    expect(r.program.entry).toBe(1);
    expect(Array.from(r.program.code)).toEqual(code);
    expect(Array.from(r.program.data)).toEqual([7, 0xffffffff]);
    expect(r.program.symbols).toEqual([{ addr: 1, kind: 0, name: 'start' }]);
  });

  it('rejects bad images', () => {
    const good = buildImage({ code });
    const bad = (f: (b: Uint8Array) => void) => {
      const b = good.slice();
      f(b);
      return parseImage(b).ok;
    };
    expect(bad((b) => { b[0] = 0; })).toBe(false); // magic
    expect(bad((b) => { b[4] = 2; })).toBe(false); // version
    expect(bad((b) => { b[8] = 9; })).toBe(false); // entry >= code_len
    expect(bad((b) => { b[12] = 99; })).toBe(false); // sizes exceed file
    expect(bad((b) => { b[32 + 3] = 0xfc; })).toBe(false); // opcode 63
    expect(parseImage(good.subarray(0, 10)).ok).toBe(false);
  });
});

describe('input tape', () => {
  it('counts events by time and round-trips through a file', () => {
    const t = new Tape();
    t.append(5, 10);
    t.append(5, 11);
    t.append(9, 12);
    expect([t.count(4), t.count(5), t.count(8), t.count(9)]).toEqual([0, 2, 2, 3]);
    const u = new Tape();
    expect(u.load(t.serialize())).toBe(true);
    expect(u.count(9)).toBe(3);
    expect(u.value(2)).toBe(12);
    t.truncateAfter(5);
    expect(t.length).toBe(2);
  });

  it('rejects malformed tapes', () => {
    const t = new Tape();
    expect(t.load(new Uint8Array(4))).toBe(false);
    expect(t.load(new Uint8Array(8))).toBe(false);
  });
});
