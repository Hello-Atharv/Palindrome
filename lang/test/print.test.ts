import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';

import { compile } from '../src/compile.js';
import { consoleText, readConsole } from '../src/console.js';
import { analyze, formatReport } from '../src/report.js';
import { interpretFull } from './interp.js';
import { mustCompile, run, type Ran } from './run.js';

const made: Ran[] = [];
afterAll(() => made.forEach((r) => r.vm.destroy()));
const text = (r: Ran): string => consoleText((a, n) => r.vm.memory(a, n));

/** Run on both engines; the machine's console must equal the interpreter's, entry for entry. */
async function printed(src: string): Promise<{ text: string; rev: Ran; entries: number }> {
  const c = mustCompile(src);
  const ref = interpretFull(c.program!);
  const logging = await run(c, 'logging');
  const rev = await run(c, 'reversible');
  made.push(logging, rev);
  expect(logging.status, logging.vm.lastError).toBe('halted');
  for (const r of [logging, rev]) {
    expect(readConsole((a, n) => r.vm.memory(a, n))).toEqual(ref.console);
    for (const reg of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15]) {
      if (!c.vars.some((v) => v.reg === reg)) expect(r.vm.registers().regs[reg], `temporary r${reg} left non-zero`).toBe(0);
    }
  }
  return { text: text(rev), rev, entries: ref.console.length };
}

describe('print in rev', () => {
  it('prints text, numbers and hex (the example program)', async () => {
    const src = readFileSync(new URL('../../examples/rev/hello.rev', import.meta.url), 'utf8');
    const r = await printed(src);
    expect(r.text).toBe('computing fib(10)...\nfib(10) = 55 (hex 0x37)\n');
  });

  it('the formats: unsigned, signed, hex and char', async () => {
    const r = await printed(`
      var x = 0xFFFFFFFE, y = 65, z = 0;
      main { print x, ",", signed x, ",", hex x, ",", char y, ",", z, ",", hex z, ",", signed 0 - 5; }`);
    expect(r.text).toBe('4294967294,-2,0xfffffffe,A,0,0x0,-5');
  });

  it('prints expressions, array elements and character literals', async () => {
    const r = await printed(`
      var a[3] = {7, 8, 9}, i = 2, s = 0;
      main { print a[i] + a[0], char 'x', char 10; print "ok"; }`);
    expect(r.text).toBe('16x\nok');
  });

  it('string escapes: newline, tab, quote and backslash', async () => {
    const r = await printed(String.raw`var q = 0; main { print "a\tb\n\"c\"\\", q; }`);
    expect(r.text).toBe('a\tb\n"c"\\0');
  });

  it('un-prints when the program runs backwards, and a procedure can be uncalled', async () => {
    const r = await printed(`
      var x = 3;
      proc greet { print "hi ", x, ";"; }
      main { call greet; call greet; uncall greet; print "!"; }`);
    expect(r.text).toBe('hi 3;!');
    // run the whole program as its own inverse: everything un-prints
    expect(r.rev.vm.setDirection(-1)).toBe('ok');
    while (r.rev.vm.stepForward() === 'ok') { /* backwards */ }
    expect(text(r.rev)).toBe('');
    expect(r.rev.vm.memory(0xfffe, 1)[0]).toBe(0);
  });

  it('works inside loops and ifs', async () => {
    const r = await printed(`
      var i = 0, n = 4;
      main {
        from (i == 0) loop {
          if (i == 2) { print "two "; } else { print i, " "; } fi (i == 2);
          i += 1;
        } until (i == n);
      }`);
    expect(r.text).toBe('0 1 two 3 ');
  });

  it('the console rewinds with time and each entry appears in a single step', async () => {
    const c = mustCompile(readFileSync(new URL('../../examples/rev/hello.rev', import.meta.url), 'utf8'));
    const r = await run(c, 'reversible');
    made.push(r);
    const end = r.vm.instructionCount;
    const full = text(r);
    let prev = '';
    for (let t = 0; t <= end; t++) {
      r.vm.runTo(t);
      const now = text(r);
      expect(now.startsWith(prev), `t=${t}: "${now}" does not extend "${prev}"`).toBe(true);
      prev = now;
    }
    expect(prev).toBe(full);
    r.vm.runTo(0);
    expect(text(r)).toBe('');
  });

  it('the cost report counts the console as garbage', async () => {
    const src = readFileSync(new URL('../../examples/rev/hello.rev', import.meta.url), 'utf8');
    const rep = await analyze(mustCompile(src), src);
    expect(rep.roundTrip).toBe(true);
    expect(rep.console).toBe('computing fib(10)...\nfib(10) = 55 (hex 0x37)\n');
    expect(rep.consoleEntries).toBeGreaterThan(30);
    expect(formatReport(rep, 'hello.rev')).toMatch(/console output .* words of garbage/);
  });
});

describe('print: mistakes are reported', () => {
  const err = (src: string): string => {
    const r = compile(src);
    expect(r.ok).toBe(false);
    return r.diagnostics.map((d) => d.message).join('\n');
  };
  it('a variable placed on the console region', () => {
    expect(err('var x @ 0xF000; main { print "x"; }')).toMatch(/overlaps the console/);
  });
  it('unknown names inside print', () => expect(err('main { print nope; }')).toMatch(/unknown variable 'nope'/));
  it('an arrays used without an index', () => expect(err('var a[2]; main { print a; }')).toMatch(/is an array/));
  it('bad strings and escapes', () => {
    expect(err('main { print "abc; }')).toMatch(/unterminated|must end/);
    expect(err(String.raw`main { print "a\q"; }`)).toMatch(/unknown escape/);
  });
  it('the format words are reserved', () => expect(err('var hex; main { }')).toMatch(/expected a variable name/));
  it('print needs a semicolon', () => expect(err('var x; main { print x }')).toMatch(/expected ';'/));
});
