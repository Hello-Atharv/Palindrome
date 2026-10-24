import { afterAll, describe, expect, it } from 'vitest';

import { compile } from '../src/compile.js';
import { analyze, formatReport } from '../src/report.js';
import { interpret } from './interp.js';
import { mustCompile, run, type Ran } from './run.js';

const made: Ran[] = [];
afterAll(() => made.forEach((r) => r.vm.destroy()));

const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

describe('an omitted fi is inferred as the test', () => {
  it('compiles to exactly the same machine code as writing the same fi', () => {
    for (const rel of ['==', '!=', '<', '>', '<=', '>=']) {
      const withFi = compile(`var a = 3, b = 5, r = 0; main { if (a ${rel} b) { r += 1; } else { r += 2; } fi (a ${rel} b); }`);
      const without = compile(`var a = 3, b = 5, r = 0; main { if (a ${rel} b) { r += 1; } else { r += 2; } }`);
      expect(withFi.ok, JSON.stringify(withFi.diagnostics)).toBe(true);
      expect(without.ok, JSON.stringify(without.diagnostics)).toBe(true);
      expect(same(withFi.image!, without.image!), `relation ${rel}`).toBe(true);
      expect(without.inferredFis).toEqual([1]);
      expect(withFi.explicitFis).toEqual([1]);
    }
  });

  it('runs correctly on both engines, matches the interpreter, and rewinds', async () => {
    for (const x of [1, 6, 5]) {
      const src = `
        var x = ${x}, y = 5, r = 0, s = 0;
        proc bump { s += 10; }
        main {
          if (x < y) { r += 1; call bump; } else { r += 2; }
          if (x == 5) { r += 100; } else { skip; }
          if (x >= 6) { r += 1000; }
        }`;
      const c = mustCompile(src);
      const ref = interpret(c.program!);
      const logging = await run(c, 'logging');
      const rev = await run(c, 'reversible');
      made.push(logging, rev);
      expect(logging.status, logging.vm.lastError).toBe('halted');
      expect(Object.fromEntries(rev.vars)).toEqual(Object.fromEntries(ref));
      const t = rev.vm.instructionCount;
      expect(rev.vm.runTo(0)).toBe('ok');
      expect(rev.vm.registers().regs.every((v, i) => v === (i === 14 ? 0x10000 : 0))).toBe(true);
      expect(rev.vm.runTo(t)).toBe('ok');
    }
  });

  it('works inside a procedure that is called and uncalled', async () => {
    const c = mustCompile(`
      var x = 3, r = 0;
      proc p { if (x == 3) { r += 5; } else { r += 7; } }
      main { call p; call p; uncall p; }`);
    const rev = await run(c, 'reversible');
    made.push(rev);
    expect(rev.vars.get('r')![0]).toBe(5);
  });

  it('does not need a fi for nested ifs whose tests survive', () => {
    const r = compile(`
      var a = 1, b = 2, c = 0;
      main { if (a < b) { if (b == 2) { c += 1; } else { c += 2; } } else { c += 3; } }`);
    expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
    expect(r.inferredFis.length).toBe(2);
  });
});

describe('when the fi cannot be inferred, the error says why', () => {
  const err = (src: string): string => {
    const r = compile(src);
    expect(r.ok).toBe(false);
    return r.diagnostics.map((d) => d.message).join('\n');
  };
  it('a branch changes a variable the test reads', () => {
    expect(err('var a = 1, b = 2; main { if (a > b) { a <=> b; } }')).toMatch(/needs an explicit fi: a branch changes 'a'/);
  });
  it('a called procedure changes it', () => {
    expect(err('var a = 1, b = 2, c = 0; proc p { b += 1; } main { if (a < b) { call p; c += 1; } else { c += 2; } }')).toMatch(/changes 'b'/);
  });
  it('the test reads an array element or a variable that lives in memory', () => {
    expect(err('var a[2] = {1, 2}, c = 0; main { if (a[0] < a[1]) { c += 1; } else { c += 2; } }')).toMatch(/from memory/);
    const names = Array.from({ length: 10 }, (_, k) => `v${k}`).join(', ');
    expect(err(`var ${names}; main { if (v9 == 0) { v0 += 1; } }`)).toMatch(/from memory/);
  });
});

describe('warnings for an fi that probably cannot separate the branches', () => {
  const warnings = (src: string): string[] => compile(src).warnings.map((w) => w.message);
  it('an fi that repeats the test after a branch changed what it reads', () => {
    const w = warnings('var a = 5, b = 3, f = 0; main { if (a > b) { a <=> b; f += 1; } fi (a > b); }');
    expect(w.join()).toMatch(/repeats the test, but a branch changes/);
  });
  it('an fi that reads only things no branch changes, and is not the test', () => {
    const w = warnings('var x = 1, q = 0, r = 0; main { if (x == 1) { r += 1; } else { r += 2; } fi (q == 0); }');
    expect(w.join()).toMatch(/gives the same answer on both paths/);
  });
  it('no warning for the normal patterns: a flag, the same untouched test, or a result variable', () => {
    expect(warnings('var a = 5, b = 3, f = 0; main { if (a > b) { a <=> b; f += 1; } fi (f != 0); }')).toEqual([]);
    expect(warnings('var u = 3, bx = 0; main { if (u < 32) { bx ^= u; } else { bx ^= 63 - u; } fi (u < 32); }')).toEqual([]);
    expect(warnings('var n = 0, r = 0; main { if (n == 0) { n += 1; r += 7; } else { r += 8; } fi (r == 7); }')).toEqual([]);
  });
});

describe('the cost report and the compiler front end', () => {
  it('the report says how many fi clauses were inferred and how many were written', async () => {
    const src = 'var a = 5, b = 3, f = 0, r = 0; out r; main { if (a > b) { a <=> b; f += 1; } fi (f != 0); if (f == 1) { r += 1; } else { r += 2; } }';
    const rep = await analyze(mustCompile(src), src);
    expect(rep.inferredFis).toBe(1);
    expect(rep.explicitFis).toBe(1);
    expect(formatReport(rep, 'x.rev')).toMatch(/1 with an inferred fi \(free\), 1 with a written fi/);
  });

  it('warnings do not stop the program from compiling and running', () => {
    const r = compile('var a = 5, b = 3, f = 0; main { if (a > b) { a <=> b; f += 1; } fi (a > b); }');
    expect(r.ok).toBe(true);
    expect(r.warnings.length).toBe(1);
  });
});
