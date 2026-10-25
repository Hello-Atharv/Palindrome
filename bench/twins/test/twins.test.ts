import { describe, expect, it } from 'vitest';

import { Checkpoints } from '../src/baselines.js';
import { Conv, assembleConv, destroys, runAll } from '../src/conv.js';
import { runPong, runSort } from '../src/scenario.js';
import { SORT_INPUT } from '../src/twins.js';

describe('the conventional machine', () => {
  it('runs a small program', () => {
    const m = new Conv(assembleConv('movi r1, 5\nmovi r2, 7\nadd r3, r1, r2\nhalt\n'));
    expect(runAll(m)).toBe('halted');
    expect(m.regs[3]).toBe(12);
  });

  it('classifies bijective and destroying instructions', () => {
    const a = (s: string): boolean => destroys(assembleConv(s + '\n').code[0]);
    expect(a('addi r1, r1, 3')).toBe(false);
    expect(a('add r1, r1, r2')).toBe(false);
    expect(a('add r1, r2, r1')).toBe(false);
    expect(a('sub r1, r1, r2')).toBe(false);
    expect(a('sub r1, r2, r1')).toBe(false);
    expect(a('xor r1, r1, r2')).toBe(false);
    expect(a('xori r1, r1, 9')).toBe(false);
    expect(a('mov r1, r1')).toBe(false);
    expect(a('mov r1, r2')).toBe(true);
    expect(a('movi r1, 0')).toBe(true);
    expect(a('add r1, r2, r3')).toBe(true);
    expect(a('add r1, r1, r1')).toBe(true); // doubling loses the top bit
    expect(a('sub r1, r1, r1')).toBe(true); // always 0
    expect(a('and r1, r1, r2')).toBe(true);
    expect(a('shri r1, r1, 3')).toBe(true);
    expect(a('ld r1, [r2+0]')).toBe(true);
    expect(a('st r1, [r2+0]')).toBe(true);
  });

  it('the diary undoes random programs exactly, step by step', () => {
    let seed = 12345;
    const rnd = (n: number): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return (seed >>> 8) % n;
    };
    const ops3 = ['add', 'sub', 'xor', 'and', 'or'];
    const opsI = ['addi', 'xori', 'andi', 'ori', 'shli', 'shri'];
    for (let trial = 0; trial < 30; trial++) {
      const lines: string[] = ['movi r14, 1024'];
      const n = 60;
      for (let i = 0; i < n; i++) {
        const r = () => `r${1 + rnd(5)}`;
        switch (rnd(8)) {
          case 0: lines.push(`movi ${r()}, ${rnd(100000)}`); break;
          case 1: lines.push(`mov ${r()}, ${r()}`); break;
          case 2: lines.push(`${ops3[rnd(5)]} ${r()}, ${r()}, ${r()}`); break;
          case 3: lines.push(`${opsI[rnd(6)]} ${r()}, ${r()}, ${rnd(31)}`); break;
          case 4: lines.push(`ld ${r()}, [r14+${rnd(16)}]`); break;
          case 5: lines.push(`st ${r()}, [r14+${rnd(16)}]`); break;
          case 6: lines.push(`blt ${r()}, ${r()}, L${i}`, `addi r1, r1, 1`, `L${i}:`); break; // a skip: creates a join
          default: lines.push(`sub ${r()}, ${r()}, ${r()}`);
        }
      }
      lines.push('halt');
      const m = new Conv(assembleConv(lines.join('\n') + '\n'));
      m.diary = true;
      const digests: string[] = [m.digest()];
      while (m.step() === 'ok') digests.push(m.digest());
      expect(m.t).toBe(digests.length - 1);
      for (let t = m.t - 1; t >= 0; t--) {
        expect(m.undo()).toBe('ok');
        expect(m.digest(), `trial ${trial} undo to t=${t}`).toBe(digests[t]);
      }
      expect(m.stack.bits).toBe(0); // nothing left over
    }
  });
});

describe('sort: reversible vs conventional twin', () => {
  it('produces the same sorted list on the screen', async () => {
    const r = await runSort();
    expect(r.convRow0).toEqual(r.revRow0);
    expect(r.convRow0).toEqual([...SORT_INPUT].sort((a, b) => a - b));
  });

  it('does so for random inputs, duplicates included', async () => {
    let seed = 7;
    const rnd = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed >>> 24;
    };
    for (let k = 0; k < 8; k++) {
      const input = Array.from({ length: 8 }, () => (rnd() & 15) << 16 | 0x40);
      const r = await runSort(input);
      expect(r.convRow0).toEqual(r.revRow0);
      expect(r.convRow0).toEqual([...input].sort((a, b) => a - b));
    }
  });

  it('the twin rewinds exactly with the tight diary', async () => {
    const r = await runSort();
    const m = r.conv;
    const end = m.digest();
    const steps = m.t;
    while (m.t > 0) expect(m.undo()).toBe('ok');
    expect(m.fb.every((w) => w === 0)).toBe(true);
    expect(m.stack.bits).toBe(0);
    while (m.t < steps) m.step();
    expect(m.digest()).toBe(end);
  });
});

describe('sort: checkpoints and the tight diary seek exactly', () => {
  it('every checkpoint interval lands on the same state as undoing with the tight diary, at every earlier time', async () => {
    const r = await runSort(undefined, [5, 25, 100]);
    const m = r.conv;
    const T = m.t;
    const end = m.digest();
    const expected: string[] = [];
    for (let t = T; t >= 0; t--) {
      expected[t] = m.digest();
      if (t > 0) m.undo();
    }
    while (m.t < T) m.step();
    expect(m.digest()).toBe(end);
    for (const [K, cp] of r.checkpoints) {
      for (let t = 0; t <= T; t++) {
        const replayed = cp.seek(m, t);
        expect(m.digest(), `K=${K} seek to ${t}`).toBe(expected[t]);
        expect(replayed).toBeLessThan(K);
      }
      cp.seek(m, T);
      expect(m.digest()).toBe(end);
    }
  });
});

describe('pong: reversible vs conventional twin', () => {
  it('draws the same picture on every frame while chasing the ball', async () => {
    const r = await runPong(300, 'chase');
    expect(r.mismatches).toEqual([]);
    expect(r.gameOver).toBe(false);
    expect(r.hits).toBeGreaterThanOrEqual(4);
  });

  it('with no input both stop on the same frame (the ball gets past the paddle)', async () => {
    const r = await runPong(100, 'none');
    expect(r.mismatches).toEqual([]);
    expect(r.gameOver).toBe(true);
    expect(r.frames).toBe(52);
  });

  it('the twin rewinds exactly with the tight diary, and checkpoints seek exactly', async () => {
    const r = await runPong(120, 'chase', [64, 500]);
    expect(r.mismatches).toEqual([]);
    const m = r.conv;
    const T = m.t;
    const end = m.digest();
    // seek by checkpoint-and-replay to a few earlier times, compare with the tight diary's answer
    const targets = [T - 1, T - 77, Math.floor(T / 2), 1000, 3, 0];
    const expected = new Map<number, string>();
    for (const t of targets) {
      while (m.t > t) m.undo();
      expected.set(t, m.digest());
    }
    while (m.t < T) m.step();
    expect(m.digest()).toBe(end);
    for (const [K, cp] of r.checkpoints) {
      for (const t of targets) {
        const replayed = cp.seek(m, t);
        expect(m.digest(), `K=${K} seek to ${t}`).toBe(expected.get(t));
        expect(replayed).toBeLessThan(K);
      }
      cp.seek(m, T);
      expect(m.digest()).toBe(end);
    }
    expect(r.checkpoints.get(64)).toBeInstanceOf(Checkpoints);
  });
});
