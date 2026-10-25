// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Op } from '../../../spec/vm_api';
import { Diagram } from './datapath/diagram';
import { BOXES, BUS_X, pointAt, regTile, route } from './datapath/layout';
import { buildScript, decodeWord, regionOf, short } from './datapath/script';
import type { Phase } from './datapath/script';
import { learnVerdict } from './program';
import type { ProgramInfo } from './program';

const w = (op: Op, ra = 0, rb = 0, low = 0): number => ((op << 26) | (ra << 22) | (rb << 18) | low) >>> 0;
const regs = (o: Record<number, number> = {}): number[] => Array.from({ length: 16 }, (_, i) => o[i] ?? 0);
const moves = (ps: Phase[]) => ps.flatMap((p) => p.moves.map((m) => `${m.from}>${m.to}`));

describe('buildScript', () => {
  it('every instruction fetches through the MAR and MBR, then decodes', () => {
    const ps = buildScript({ word: w(Op.NOP), pc: 3, pcAfter: 4, before: regs(), after: regs() });
    expect(moves(ps.slice(0, 4))).toEqual(['PC>MAR', 'PC>INC', 'MAR>MEM', 'MEM>MBR', 'MBR>CIR', 'INC>PC', 'CIR>CU']);
    expect(ps[2].effects).toContainEqual({ kind: 'reg', index: 16, before: 3, after: 4 });
    expect(ps[1].effects).toContainEqual({ kind: 'code', addr: 3 });
  });

  it('ADD sends both registers to the ALU and the result back', () => {
    const ps = buildScript({ word: w(Op.ADD, 1, 2), pc: 0, pcAfter: 1, before: regs({ 1: 5, 2: 3 }), after: regs({ 1: 8, 2: 3 }) });
    expect(moves(ps.slice(4))).toEqual(['R1>ALU', 'R2>ALU', 'ALU>R1']);
    expect(ps[5].moves[0].label).toBe('8');
    expect(ps[5].effects).toEqual([{ kind: 'reg', index: 1, before: 5, after: 8 }]);
  });

  it('XST goes through the ALU, MAR and MBR into memory; the screen goes to the output instead', () => {
    const data = buildScript({ word: w(Op.XST, 3, 1, 4), pc: 0, pcAfter: 1, before: regs({ 1: 10, 3: 7 }), after: regs({ 1: 10, 3: 7 }) });
    expect(moves(data.slice(4))).toEqual(['R1>ALU', 'CIR>ALU', 'ALU>MAR', 'R3>MBR', 'MAR>MEM', 'MBR>MEM']);
    expect(data[5].effects).toContainEqual({ kind: 'text', node: 'MAR', text: 'D14' });
    expect(data[7].effects).toEqual([{ kind: 'mem', addr: 14, mode: 'write' }]);
    const screen = buildScript({ word: w(Op.XST, 3, 1, 5), pc: 0, pcAfter: 1, before: regs({ 1: 0x20000, 3: 7 }), after: regs({ 1: 0x20000, 3: 7 }) });
    expect(moves(screen.slice(4)).slice(-1)).toEqual(['MBR>OUT']);
  });

  it('XLD reads memory (or the input window) into the MBR, then xors it into the register', () => {
    const ld = buildScript({ word: w(Op.XLD, 2, 1, 0), pc: 0, pcAfter: 1, before: regs({ 1: 8 }), after: regs({ 1: 8, 2: 42 }) });
    expect(moves(ld.slice(4))).toEqual(['R1>ALU', 'CIR>ALU', 'ALU>MAR', 'MAR>MEM', 'MEM>MBR', 'R2>ALU', 'MBR>ALU', 'ALU>R2']);
    expect(ld[6].effects).toContainEqual({ kind: 'mem', addr: 8, mode: 'read' });
    const inp = buildScript({ word: w(Op.XLD, 2, 1, 1), pc: 0, pcAfter: 1, before: regs({ 1: 0x30000 }), after: regs({ 1: 0x30000, 2: 1 }) });
    expect(moves(inp.slice(4))).toContain('IN>MBR');
  });

  it('BR: taken loads the PC from the instruction, not taken does not', () => {
    const br = (taken: boolean) => {
      const r = regs(taken ? { 1: 3, 2: 3 } : { 1: 3, 2: 4 });
      return buildScript({ word: w(Op.BR, 1, 2, (1 << 16) | 9), pc: 4, pcAfter: taken ? 9 : 5, before: r, after: r });
    };
    expect(moves(br(true).slice(4))).toEqual(['R1>ALU', 'R2>ALU', 'ALU>STATUS', 'CIR>PC']);
    expect(moves(br(false).slice(4))).toEqual(['R1>ALU', 'R2>ALU', 'ALU>STATUS']);
  });

  it('CALL and RET use the stack pointer and the stack memory', () => {
    const call = buildScript({ word: w(Op.CALL, 0, 0, 7), pc: 1, pcAfter: 7, before: regs({ 14: 0x10000 }), after: regs({ 14: 0x10001 }) });
    expect(moves(call.slice(4))).toEqual(['R14>MAR', 'INC>MBR', 'MAR>MEM', 'MBR>MEM', 'R14>ALU', 'ALU>R14', 'CIR>PC']);
    const ret = buildScript({ word: w(Op.RET), pc: 6, pcAfter: 2, before: regs({ 14: 0x10001 }), after: regs({ 14: 0x10000 }) });
    expect(moves(ret.slice(4)).slice(-1)).toEqual(['MBR>PC']);
  });

  it('LND, PROC and NOP only light the control unit', () => {
    for (const op of [Op.LND, Op.PROC, Op.NOP]) {
      const ps = buildScript({ word: w(op), pc: 0, pcAfter: 1, before: regs(), after: regs() });
      expect(ps).toHaveLength(5);
      expect(ps[4].moves).toEqual([]);
      expect(ps[4].lit).toEqual(['CU']);
    }
  });

  it('decodes and formats', () => {
    expect(decodeWord(w(Op.ADDI, 3, 0, 0x3fffb)).imm).toBe(-5);
    expect(short(0xffffffff)).toBe('-1');
    expect(short(0x12345678)).toBe('0x12345678');
    expect(regionOf(0x20003)).toBe('screen');
    expect(regionOf(0x30001)).toBe('input');
  });
});

describe('routing', () => {
  it('runs between nodes through the bus and ends on their anchors', () => {
    const r = route('R3', 'ALU');
    expect(r[0]).toEqual({ x: 250, y: regTile(3).y + 10 });
    expect(r.some((p) => p.x === BUS_X)).toBe(true);
    expect(r[r.length - 1]).toEqual({ x: BOXES.ALU.x, y: 340 });
  });

  it('uses direct wires for the control unit and the data memory', () => {
    expect(route('CIR', 'CU')).toEqual([{ x: 82, y: 346 }, { x: 82, y: 376 }]);
    // the arrow heads are small, so the wires they sit on are long enough to show one: CIR to CU and bus to the condition box
    expect(Math.hypot(...[0, 1].map((k) => [route('CIR', 'CU')[1].x - route('CIR', 'CU')[0].x, route('CIR', 'CU')[1].y - route('CIR', 'CU')[0].y][k]))).toBeGreaterThanOrEqual(30);
    const toStatus = route('ALU', 'STATUS');
    expect(Math.abs(toStatus[toStatus.length - 1].x - BUS_X)).toBeGreaterThanOrEqual(30);
    expect(route('MAR', 'MEM')[1].x).toBe(566);
  });

  it('pointAt walks a polyline by length', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    expect(pointAt(pts, 0)).toEqual({ x: 0, y: 0 });
    expect(pointAt(pts, 0.5)).toEqual({ x: 10, y: 0 });
    expect(pointAt(pts, 0.75)).toEqual({ x: 10, y: 5 });
    expect(pointAt(pts, 2)).toEqual({ x: 10, y: 10 });
  });
});

describe('Diagram', () => {
  const mk = () => {
    const log: string[] = [];
    const d = new Diagram({ onNote: (t) => log.push(`note:${t.slice(0, 12)}`), onCode: (a) => log.push(`code:${a}`), onMem: (a, m) => log.push(`mem:${a}:${m}`) });
    return { d, log };
  };
  const vals = (d: Diagram, n: number) => [...d.el.querySelectorAll('.dp-regs .dp-val')].slice(0, n).map((e) => e.textContent);

  it('shows 16 registers and the PC', () => {
    const { d } = mk();
    d.show(regs({ 1: 7 }), 5);
    expect(d.el.querySelectorAll('.dp-tile')).toHaveLength(17);
    expect(vals(d, 3)).toEqual(['0', '7', '0']);
  });

  it('plays forward: effects fire in order and the display is left for the caller to settle', async () => {
    const { d, log } = mk();
    const before = regs({ 1: 5, 2: 3 }), after = regs({ 1: 8, 2: 3 });
    const ps = buildScript({ word: w(Op.ADD, 1, 2), pc: 0, pcAfter: 1, before, after });
    const done = d.play(ps, { reversed: false, pace: { unitsPerSec: 1e6, minMs: 1, dwellMs: 1 }, before, after, pcBefore: 0, pcAfter: 1 });
    expect(d.el.dataset.dir).toBe('fwd');
    await done;
    expect(log[0].startsWith('note:Fetch')).toBe(true);
    expect(log).toContain('code:0');
    expect(vals(d, 3)).toEqual(['0', '8', '3']); // the result arrived in r1
    expect(d.el.dataset.dir).toBeUndefined(); // cleared at the end
  });

  it('plays backwards: reversed order, values return to the earlier state', async () => {
    const { d, log } = mk();
    const before = regs({ 1: 5, 2: 3 }), after = regs({ 1: 8, 2: 3 });
    const ps = buildScript({ word: w(Op.ADD, 1, 2), pc: 0, pcAfter: 1, before, after });
    const done = d.play(ps, { reversed: true, pace: { unitsPerSec: 1e6, minMs: 1, dwellMs: 1 }, before, after, pcBefore: 0, pcAfter: 1 });
    expect(d.el.dataset.dir).toBe('back');
    expect(vals(d, 3)).toEqual(['0', '8', '3']); // starts from the later state
    await done;
    expect(log[0]).toContain('Rewinding');
    expect(vals(d, 3)).toEqual(['0', '5', '3']); // ends at the earlier state
  });

  it('a new play cancels the running one', async () => {
    const { d } = mk();
    const before = regs(), after = regs({ 1: 1 });
    const ps = buildScript({ word: w(Op.ADDI, 1, 0, 1), pc: 0, pcAfter: 1, before, after });
    const first = d.play(ps, { reversed: false, pace: { unitsPerSec: 1, minMs: 5000, dwellMs: 5000 }, before, after, pcBefore: 0, pcAfter: 1 });
    d.cancel();
    await first; // resolves promptly instead of waiting seconds per phase
    expect(d.el.querySelectorAll('.dp-packet')).toHaveLength(0);
  });
});

describe('learnVerdict', () => {
  const info = (codeLen: number, dataLen: number): ProgramInfo => ({
    name: 'x', image: new Uint8Array(), codeLen, dataLen, entry: 0, labels: new Map(), dataLabels: [], garbage: [],
  });

  it('allows simple programs and refuses sort, cipher and anything unloaded', () => {
    expect(learnVerdict(info(12, 0)).ok).toBe(true);
    expect(learnVerdict(info(30, 32)).ok).toBe(true);
    expect(learnVerdict(info(189, 27)).ok).toBe(false); // sort
    expect(learnVerdict(info(37, 35)).ok).toBe(false); // cipher
    expect(learnVerdict(null).ok).toBe(false);
    expect(learnVerdict(info(189, 27)).why).toContain('Too large to animate');
  });
});
