import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';

import { compile } from '../src/compile.js';
import { parse } from '../src/parser.js';
import { interpret } from './interp.js';
import { analyze, formatReport } from '../src/report.js';
import { mustCompile, run, type Ran } from './run.js';

const made: Ran[] = [];
afterAll(() => made.forEach((r) => r.vm.destroy()));

/** Compile, run on both engines, compare with the reference interpreter, then run backwards and check we are back at the start. */
async function check(src: string, input: number[] = []): Promise<{ get(n: string): number; words(n: string): number[] }> {
  const c = mustCompile(src);
  const expected = interpret(c.program!, input);
  const logging = await run(c, 'logging', input); // this engine checks every br/lnd assertion
  const rev = await run(c, 'reversible', input);
  made.push(logging, rev);
  expect(logging.status, `logging engine: ${logging.vm.lastError}`).toBe('halted');
  expect(rev.status).toBe('halted');
  expect(Object.fromEntries(rev.vars)).toEqual(Object.fromEntries(expected));
  expect(Object.fromEntries(logging.vars)).toEqual(Object.fromEntries(expected));
  expect(rev.steps).toBe(logging.steps);
  // temporaries are zero again, stack is empty
  const regs = rev.vm.registers().regs;
  const used = new Set(c.vars.map((v) => v.reg));
  for (let r = 1; r <= 15; r++) if (!used.has(r) && r !== 14) expect(regs[r], `temporary r${r} left non-zero`).toBe(0);
  expect(regs[14]).toBe(0x10000);
  // backwards: every step undone gives the initial state, and running forward again gives the same answer
  const t = rev.vm.instructionCount;
  expect(rev.vm.runTo(0)).toBe('ok');
  expect(rev.vm.registers().regs.every((x, i) => x === (i === 14 ? 0x10000 : 0))).toBe(true);
  expect(Array.from(rev.vm.memory(0, 0x20800)) .every((x, i) => x === rev.startMem[i]), 'memory back to the loaded image').toBe(true);
  expect(rev.vm.runTo(t)).toBe('ok');
  expect(Array.from(rev.vm.registers().regs)).toEqual(Array.from(logging.vm.registers().regs));
  return { get: (n: string) => rev.vars.get(n)![0], words: (n: string) => rev.vars.get(n)! };
}

describe('rev language', () => {
  it('fibonacci', async () => {
    const v = await check(readFileSync(new URL('../examples/fib.rev', import.meta.url), 'utf8'));
    expect(v.get('a')).toBe(55);
    expect(v.get('b')).toBe(89);
  });

  it('arithmetic and bitwise expressions', async () => {
    const z = await check(`
      var x = 5, y = 3, z = 0;
      main { z += x + y; }`);
    expect(z.get('z')).toBe(8);
    const w = await check(`
      var x = 12, y = 10, a = 0, b = 0, c = 0, d = 0, e = 0, f = 0;
      main {
        a += x & y;
        b += x | y;
        c += x ^ y;
        d += ~x;
        e += rol(x, 4) - y;
        f += -x + 100000000;
      }`);
    expect(w.get('a')).toBe(12 & 10);
    expect(w.get('b')).toBe(12 | 10);
    expect(w.get('c')).toBe(12 ^ 10);
    expect(w.get('d')).toBe(~12 >>> 0);
    expect(w.get('e')).toBe(192 - 10);
    expect(w.get('f')).toBe((-12 + 100000000) >>> 0);
  });

  it('big constants', async () => {
    const v = await check(`
      var a = 0xDEADBEEF, b = 0, c = 0, d = 70000;
      main { b += 0x12345678; c ^= 0xFFFF0000; c -= 5; d += 0xFFFFFFFF; a -= 0x80000000; }`);
    expect(v.get('a')).toBe((0xdeadbeef - 0x80000000) >>> 0);
    expect(v.get('b')).toBe(0x12345678);
    expect(v.get('c')).toBe((0xffff0000 - 5) >>> 0);
    expect(v.get('d')).toBe(69999);
  });

  it('if / else with an exit assertion', async () => {
    for (const x of [3, 8]) {
      const v = await check(`
        var x = ${x}, y = 5, r = 0;
        main {
          if (x < y) { r += 1; } else { r += 2; } fi (r == 1);
        }`);
      expect(v.get('r')).toBe(x < 5 ? 1 : 2);
    }
  });

  it('if with ==, != and constants in the conditions', async () => {
    for (const x of [0, 7, 9]) {
      const v = await check(`
        var x = ${x}, r = 0, t = 0;
        main {
          if (x == 7) { r += 10; } else { r += 20; t += 1; } fi (t == 0);
        }`);
      expect(v.get('r')).toBe(x === 7 ? 10 : 20);
    }
  });

  it('every relation works in the entry test and in the fi assertion', async () => {
    const rel = ['==', '!=', '<', '>', '<=', '>='];
    let cases = 0;
    // r ends as 1 or 2 depending on the branch; the assertion is chosen to agree with the branch taken
    const holds = (op: string, a: number, b: number): boolean => ({ '==': a === b, '!=': a !== b, '<': a < b, '>': a > b, '<=': a <= b, '>=': a >= b }[op]!);
    for (const op1 of rel) {
      for (const op2 of rel) {
        for (const [a, b] of [[1, 2], [2, 2], [3, 2]]) {
          // fi condition on (r, k): then sets r = 1, else r = 2; pick k so the assertion is true after then and false after else
          const src = `var a = ${a}, b = ${b}, r = 0, k = 2;
            main { if (a ${op1} b) { r += 1; } else { r += 2; } fi (r ${op2} k); }`;
          const thenRuns = holds(op1, a, b);
          const afterThen = holds(op2, 1, 2);
          const afterElse = holds(op2, 2, 2);
          if (afterThen !== true || afterElse !== false) continue; // this (op2, k) pair does not separate the branches
          const v = await check(src);
          expect(v.get('r')).toBe(thenRuns ? 1 : 2);
          cases++;
        }
      }
    }
    expect(cases).toBeGreaterThan(30);
  });

  it('nested ifs and an if without else', async () => {
    const v = await check(`
      var a = 4, b = 9, hi = 0, lo = 0, same = 0;
      main {
        if (a < b) { lo += a; hi += b; } else { lo += b; hi += a; } fi (hi > lo);
        if (a == b) { same += 1; } fi (same != 0);
      }`);
    expect([v.get('lo'), v.get('hi'), v.get('same')]).toEqual([4, 9, 0]);
  });

  it('loops: empty first body, a first body, and a zero-trip exit', async () => {
    const v = await check(`
      var n = 5, i = 0, s = 0;
      main { from (i == 0) loop { s += i; i += 1; } until (i == n); }`);
    expect(v.get('s')).toBe(0 + 1 + 2 + 3 + 4);
    const w = await check(`
      var i = 0, j = 0, k = 0;
      main { from (i == 0) do { j += 3; } loop { i += 1; k += 1; } until (j == 12); }`);
    expect(w.get('k')).toBe(3);
    const z = await check(`
      var n = 0, i = 0, s = 7;
      main { from (i == 0) loop { s += 1; i += 1; } until (i == n); }`);
    expect(z.get('s')).toBe(7);
  });

  it('procedures and uncall', async () => {
    const v = await check(`
      var a = 1, b = 0;
      proc double_into_b { b += a; b += a; }
      proc bump { a += 5; call double_into_b; }
      main { call bump; call bump; uncall bump; }`);
    expect(v.get('a')).toBe(6);
    expect(v.get('b')).toBe(12);
  });

  it('uncall of a procedure with a loop undoes it exactly', async () => {
    const v = await check(`
      var n = 6, i = 0, a = 0, b = 1;
      proc fibs { from (i == 0) loop { a += b; a <=> b; i += 1; } until (i == n); }
      main { call fibs; uncall fibs; }`);
    expect([v.get('i'), v.get('a'), v.get('b')]).toEqual([0, 0, 1]);
  });

  it('uncall of a procedure with if, loop and a nested call undoes it exactly', async () => {
    const v = await check(`
      var x = 9, y = 4, lo = 0, hi = 0, i = 0, swapped = 0;
      proc order { if (x < y) { lo += x; hi += y; } else { lo += y; hi += x; swapped += 1; } fi (swapped == 0); }
      proc count { from (i == 0) loop { i += 1; x += 2; } until (i == 3); }
      proc both { call order; call count; }
      main { call both; uncall both; call both; }`);
    expect([v.get('lo'), v.get('hi'), v.get('i'), v.get('x'), v.get('swapped')]).toEqual([4, 9, 3, 15, 1]);
  });

  it('swap and skip', async () => {
    const v = await check('var a = 1, b = 2; main { a <=> b; skip; }');
    expect([v.get('a'), v.get('b')]).toEqual([2, 1]);
  });

  it('programs that begin with a loop, or have no statements, still assemble', async () => {
    await check('var i = 0; main { from (i == 0) loop { i += 1; } until (i == 3); }');
    await check('main { skip; }');
  });
});


describe('procedure calls inside blocks that use constants in their conditions', () => {
  // A procedure assumes every temporary register is zero when it is entered. Constants used by an enclosing if/loop condition
  // must therefore not be sitting in temporaries while the body runs. (This was a real bug, found by the Pong score digits.)
  it('call inside an if whose test and assertion use the same constant', async () => {
    for (const q of [63, 5]) {
      const v = await check(`
        var q = ${q}, r = 0, out1 = 0, s = 0;
        proc scribble { s ^= 0x12345 + 77; s ^= 0x12345 + 77; r += 1000000; r -= 1000000; r += 7; }
        main {
          if (q == 63) { call scribble; out1 += 1; } else { skip; } fi (q == 63);
          if (q == 63) { call scribble; } else { call scribble; } fi (q == 63);
        }`);
      expect(v.get('r')).toBe(q === 63 ? 14 : 7); // both ifs call it when q is 63; only the second (its else) when not
    }
  });

  it('call inside a loop whose until and from conditions use constants', async () => {
    const v = await check(`
      var i = 5, n = 0, r = 0;
      proc bump { r += 3; n ^= 0x9ABCDE; n ^= 0x9ABCDE; }
      main {
        from (i == 5) loop { call bump; i += 1; } until (i == 9);
        from (i == 9) do { call bump; } loop { i += 1; } until (i == 12);
      }`);
    expect(v.get('r')).toBe(3 * 4 + 3 * 4); // 4 passes through the first loop, 4 through the second
    expect(v.get('i')).toBe(12);
  });
});

describe('arrays, memory variables, placement and input', () => {
  it('reads and updates array elements with variable and constant indexes', async () => {
    const v = await check(`
      var a[6] = {10, 20, 30}, i = 2, x = 0, y = 0;
      main {
        x += a[i];
        a[i] += 5;
        a[0] -= 3;
        a[4] ^= 0xFF;
        y += a[i] + a[1];
        a[i + 1] += x;
      }`);
    expect(v.words('a')).toEqual([7, 20, 35, 30, 0xff, 0]);
    expect([v.get('x'), v.get('y')]).toEqual([30, 55]);
  });

  it('swaps array elements, including an element with itself and a register with an element', async () => {
    const v = await check(`
      var a[4] = {1, 2, 3, 4}, i = 1, j = 3, r = 9;
      main {
        a[i] <=> a[j];
        a[i] <=> a[i];
        r <=> a[0];
        a[2] <=> r;
      }`);
    expect(v.words('a')).toEqual([9, 4, 1, 2]);
    expect(v.get('r')).toBe(3);
  });

  it('spills scalars beyond nine registers to memory, and they work everywhere', async () => {
    const names = Array.from({ length: 12 }, (_, k) => `v${k}`);
    const decl = names.map((n, k) => `${n} = ${k + 1}`).join(', ');
    const v = await check(`
      var k = 0, flag = 0, ${decl}, t = 0;
      out v11;
      proc spin { v10 += v11; v9 <=> v11; }
      main {
        v10 += v0 + v1;
        v11 ^= v10;
        if (v10 > v9) { v11 += 1; v9 += 100; flag += 1; } else { v9 -= 1; } fi (flag != 0);
        from (k == 0) loop { k += 1; v11 += 1; } until (k > 3);
        call spin; uncall spin; call spin;
      }`);
    // compare against the interpreter happens inside check(); spot-check one value as well
    expect(v.get('v0')).toBe(1);
  });

  it('a condition may compare array elements before an if', async () => {
    const v = await check(`
      var a[3] = {5, 2, 9}, swapped = 0;
      main {
        if (a[0] > a[1]) { a[0] <=> a[1]; swapped += 1; } fi (swapped != 0);
        if (a[1] > a[2]) { a[1] <=> a[2]; swapped += 2; } fi (swapped > 2);
      }`.replace('swapped > 2', 'swapped != 1'));
    expect(v.words('a')).toEqual([2, 5, 9]);
  });

  it('draws into the framebuffer through an absolute array, and rewinds the picture', async () => {
    const v = await check(`
      var screen[2048] @ 0x20000, x = 3, y = 2, c = 0xFF00FF;
      main { screen[rol(y, 6) + x] ^= c; screen[0] ^= 1; }`);
    expect(v.words('screen')[2 * 64 + 3]).toBe(0xff00ff);
    expect(v.words('screen')[0]).toBe(1);
  });

  it('reads the latest key event and the event count', async () => {
    const none = await check('var e = 0, l = 0; main { e += events; l += latest; }');
    expect([none.get('e'), none.get('l')]).toEqual([0, 0]);
    const some = await check('var e = 0, l = 0; main { e += events; l += latest; }', [0x57, 0x53, 0x181]);
    expect([some.get('e'), some.get('l')]).toEqual([3, 0x181]);
  });

  it('initial data and memory survive a full run backwards', async () => {
    await check(`
      var a[5] = {1, 2, 3, 4, 5}, i = 0, s = 0;
      main { from (i == 0) loop { s += a[i]; a[i] += s; i += 1; } until (i == 5); }`);
  });
});

describe('compile errors', () => {
  const err = (src: string): string => {
    const r = compile(src);
    expect(r.ok).toBe(false);
    return r.diagnostics.map((d) => `${d.line}: ${d.message}`).join('\n');
  };
  it('rejects the variable on both sides', () => {
    expect(err('var x = 1; main { x += x + 1; }')).toMatch(/both sides/);
  });
  it('rejects plain assignment', () => {
    expect(err('var x; main { x = 1; }')).toMatch(/destroy/);
  });
  it('rejects unknown names and bad structure', () => {
    expect(err('main { y += 1; }')).toMatch(/unknown variable 'y'/);
    expect(err('var x; main { call nope; }')).toMatch(/unknown procedure/);
    expect(err('var x;')).toMatch(/no 'main/);
    expect(err('var x, x; main { }')).toMatch(/declared twice/);
    expect(err('var a; main { a <=> a; }')).toMatch(/itself/);
  });
  it('rejects recursion for now', () => {
    expect(err('var x; proc p { call p; } main { call p; }')).toMatch(/recursion/);
  });
  it('rejects a loop entry condition the machine cannot test as false, with a way out', () => {
    expect(err('var i, n; main { from (i < 3) loop { i += 1; } until (i == 3); }')).toMatch(/'from' condition/);
  });
  it('reports parse errors with the line', () => {
    const p = parse('var x;\nmain {\n  x += ;\n}');
    expect(p.diagnostics[0].line).toBe(3);
  });
  it('rejects scalars used as arrays and arrays used as scalars', () => {
    expect(err('var x; main { x[0] += 1; }')).toMatch(/not an array/);
    expect(err('var a[4]; main { a += 1; }')).toMatch(/is an array/);
    expect(err('var a[4], x; main { x += a; }')).toMatch(/is an array/);
  });
  it('rejects an array element updated from its own array', () => {
    expect(err('var a[4], i; main { a[i] += a[0]; }')).toMatch(/read on the right/);
    expect(err('var a[4]; main { a[a[0]] += 1; }')).toMatch(/cannot itself read/);
    expect(err('var a[4], i; main { i <=> a[i]; }')).toMatch(/swap changes/);
  });
  it('rejects array elements where the machine tests after the bodies have run', () => {
    expect(err('var a[4], i, f; main { if (i == 0) { f += 1; } fi (a[0] != 0); }')).toMatch(/cannot compare an array element/);
  });
  it('rejects a memory-resident variable where the machine tests after the bodies have run', () => {
    const names = Array.from({ length: 10 }, (_, k) => `v${k}`).join(', ');
    expect(err(`var ${names}; main { if (v0 == 0) { v1 += 1; } fi (v9 != 0); }`)).toMatch(/lives in memory/);
  });
  it('rejects bad placements', () => {
    expect(err('var a[4] @ 0x50000; main { }')).toMatch(/not in mapped memory/);
    expect(err('var s[4] @ 0x20000 = {1}; main { }')).toMatch(/cannot have initial values/);
    expect(err('var f[2] @ 0xFFFE; main { }')).toMatch(/FRAME/);
  });
});

describe('cost report', () => {
  it('attributes steps to lines, finds the garbage, and verifies the round trip', async () => {
    const src = readFileSync(new URL('../examples/fib.rev', import.meta.url), 'utf8');
    const r = await analyze(mustCompile(src), src);
    expect(r.haltStatus).toBe('halted');
    expect(r.roundTrip).toBe(true);
    expect(r.reversibleHistoryBytes).toBe(0);
    expect(r.diaryBytes).toBe(48 * r.steps);
    expect(r.lines.reduce((s, l) => s + l.steps, 0)).toBe(r.steps); // every executed step belongs to some line
    expect(r.garbageVars).toEqual(['i']); // the loop counter ends at n; n itself is an untouched input
    expect(r.dirtyRegisters).toEqual([]);
    expect(formatReport(r, 'fib.rev')).toMatch(/GARBAGE/);
  });

  it('counts the sort flags as garbage and runs back to the unsorted list', async () => {
    const src = readFileSync(new URL('../examples/sort3.rev', import.meta.url), 'utf8');
    const c = mustCompile(src);
    const r = await analyze(c, src);
    expect(r.roundTrip).toBe(true);
    expect(r.vars.filter((v) => v.isOut).map((v) => v.final[0])).toEqual([2, 5, 7]);
    expect(r.garbageVars.length).toBeGreaterThan(0);
    expect(r.garbageBits).toBe(32 * r.garbageVars.length);
  });

  it('the eight-number sort in rev matches the hand-written assembly sort, and costs close to it', async () => {
    const src = readFileSync(new URL('../examples/sort8.rev', import.meta.url), 'utf8');
    const c = mustCompile(src);
    const r = await analyze(c, src);
    expect(r.roundTrip).toBe(true);
    const a = r.vars.find((v) => v.name === 'a')!;
    expect(a.final).toEqual([...a.initial].sort((x, y) => x - y));
    const g = r.vars.find((v) => v.name === 'garbage')!;
    expect(g.final.filter((x) => x !== 0).length).toBe(14); // the same 14 swaps as programs/sort.s
    // the hand-written programs/sort.s is 341 instructions and 311 steps; the compiler should stay in that neighbourhood
    expect(r.steps).toBeLessThan(311 * 1.25);
    expect(r.codeWords).toBeLessThan(341 * 1.5);
  });

  it('reports an assertion the program breaks, instead of silently running', async () => {
    const src = 'var a = 1, f = 0; out a; main { if (a == 1) { skip; } else { skip; } fi (f != 0); }';
    const r = await analyze(mustCompile(src), src);
    expect(r.fault).toMatch(/assertion/i);
  });
});
