// Random rev programs, checked against the independent interpreter (test/interp.ts) on both real engines, then run backwards.
// Every generated program is valid by construction (guards g and h are never changed inside an if, loop counters only by the loop,
// expressions never read their own target), so ANY disagreement is a compiler or engine bug. Failures print the seed and the source.
import { describe, expect, it } from 'vitest';

import { compile } from '../src/compile.js';
import { readConsole } from '../src/console.js';
import { interpretFull } from './interp.js';
import { mustCompile, run, type Ran } from './run.js';


type Rng = () => number;
const rng = (seed: number): Rng => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const int = (r: Rng, n: number): number => Math.floor(r() * n);
const pick = <T,>(r: Rng, xs: readonly T[]): T => xs[int(r, xs.length)];

const REG_TARGETS = ['a', 'b', 'c'] as const; // in registers
const MEM_TARGETS = ['d', 'e', 'm', 'n'] as const; // in memory
const TARGETS = [...REG_TARGETS, ...MEM_TARGETS] as const;
const GUARDS = ['g', 'h'] as const; // read by if tests, never changed inside an if
const COUNTERS = ['i', 'j'] as const;
const REGS = [...REG_TARGETS, ...GUARDS, ...COUNTERS] as const;
const CONSTS = ['0', '1', '2', '3', '7', '31', '100', '0xFF', '65535', '262143', '262144', '0x7FFFFFFF', '0xFFFFFFFF', '123456789'];
const RELS = ['==', '!=', '<', '>', '<=', '>='] as const;
const OPS = ['+=', '-=', '^='] as const;

function leaf(r: Rng, exclude: ReadonlySet<string>, arrays: boolean): string {
  const regs = REGS.filter((v) => !exclude.has(v));
  const mems = MEM_TARGETS.filter((v) => !exclude.has(v));
  const k = int(r, 20);
  if (k < 11) return pick(r, regs);
  if (k < 13 && mems.length) return pick(r, mems);
  if (k < 18 || !arrays) return pick(r, CONSTS);
  return `arr[${pick(r, regs)} & 7]`;
}

function expr(r: Rng, depth: number, exclude: ReadonlySet<string>, arrays: boolean): string {
  if (depth === 0 || int(r, 3) === 0) return leaf(r, exclude, arrays);
  const a = expr(r, depth - 1, exclude, arrays);
  const b = expr(r, depth - 1, exclude, arrays);
  switch (int(r, 8)) {
    case 0: return `(${a} + ${b})`;
    case 1: return `(${a} - ${b})`;
    case 2: return `(${a} ^ ${b})`;
    case 3: return `(${a} & ${b})`;
    case 4: return `(${a} | ${b})`;
    case 5: return `~(${a})`;
    case 6: return `-(${a})`;
    default: return `rol(${a}, ${1 + int(r, 31)})`;
  }
}

function simple(r: Rng, noPrint = false): string {
  const k = noPrint ? int(r, 10) : int(r, 12); // procedures never print: un-printing before printing is not a valid program
  if (k < 5) {
    const t = pick(r, TARGETS);
    return `${t} ${pick(r, OPS)} ${expr(r, 2, new Set([t]), true)};`;
  }
  if (k < 7) return `arr[${pick(r, REGS)} & 7] ${pick(r, OPS)} ${expr(r, 2, new Set(), false)};`;
  if (k === 7) {
    const [x, y] = [pick(r, TARGETS), pick(r, TARGETS)];
    return x === y ? 'skip;' : `${x} <=> ${y};`;
  }
  if (k === 8) return `arr[${int(r, 8)}] <=> ${pick(r, TARGETS)};`;
  if (k === 9) return `arr[${int(r, 8)}] <=> arr[${int(r, 8)}];`;
  if (k === 10) return `print ${pick(r, ['', 'signed ', 'hex ', 'char '])}${expr(r, 1, new Set(), false)};`;
  return `print "v", ${leaf(r, new Set(), false)};`;
}

function block(r: Rng, depth: number, used: Set<string>, n: number, procs: string[]): string {
  const out: string[] = [];
  for (let k = 0; k < n; k++) {
    const kind = int(r, 10);
    if (kind < 5 || depth >= 2) out.push(simple(r));
    else if (kind < 7) {
      // an if whose test reads only guards and constants, so its fi can be inferred
      const operand = (): string => pick(r, [...GUARDS, ...GUARDS, '0', '1', '5', '100']);
      out.push(`if (${operand()} ${pick(r, RELS)} ${operand()}) { ${block(r, depth + 1, used, 1 + int(r, 3), procs)} } else { ${block(r, depth + 1, used, int(r, 3), procs)} }`);
    } else if (kind < 9) {
      const free = COUNTERS.filter((c) => !used.has(c));
      if (free.length === 0) { out.push(simple(r)); continue; }
      const c = pick(r, free);
      const K = 1 + int(r, 4);
      used.add(c);
      out.push(`from (${c} == 0) loop { ${block(r, depth + 1, used, 1 + int(r, 3), procs)} ${c} += 1; } until (${c} == ${K}); ${c} -= ${K};`);
      used.delete(c);
    } else if (procs.length) out.push(`${pick(r, ['call', 'uncall'])} ${pick(r, procs)};`);
    else out.push(depth === 0 ? `${pick(r, GUARDS)} ${pick(r, OPS)} ${pick(r, CONSTS)};` : simple(r)); // only the top level changes guards
  }
  return out.join(' ');
}

export function program(seed: number): string {
  const r = rng(seed);
  const c = (): string => pick(r, CONSTS);
  const procs = ['p1', 'p2'].slice(0, int(r, 3));
  const lines = [
    `var a = ${c()}, b = ${c()}, c = ${c()}, g = ${c()}, h = ${c()}, i = 0, j = 0;`,
    `var d @ mem = ${c()}, e @ mem = ${c()}, m @ mem = ${c()}, n @ mem = ${c()};`,
    'var arr[8] = {1, 2, 3, 4, 5, 6, 7, 8};',
  ];
  for (const p of procs) lines.push(`proc ${p} { ${Array.from({ length: 1 + int(r, 3) }, () => simple(r, true)).join(' ')} }`);
  const main: string[] = [];
  for (let k = 0; k < 4 + int(r, 5); k++) {
    main.push(block(r, 0, new Set(), 1 + int(r, 2), procs));
    if (int(r, 3) === 0) main.push(`${pick(r, GUARDS)} ${pick(r, OPS)} ${pick(r, CONSTS)};`);
  }
  lines.push(`main { ${main.join('\n  ')} }`);
  return lines.join('\n');
}

const SEEDS = Number(process.env.FUZZ_SEEDS ?? 600); // set FUZZ_SEEDS=5000 for a deep search

describe('random rev programs agree with the interpreter on both engines, and run back to the start', () => {
  it(`${SEEDS} programs`, async () => {
    let compiled = 0;
    let skipped = 0;
    const bad: string[] = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
      const src = program(seed);
      const c = compile(src);
      if (!c.ok) {
        const msg = c.diagnostics.map((d) => d.message).join('; ');
        if (/out of temporary registers/.test(msg)) { skipped++; continue; } // a known limit, not a miscompile
        bad.push(`seed ${seed}: did not compile: ${msg}\n${src}`);
        continue;
      }
      compiled++;
      let logging: Ran | undefined;
      let rev: Ran | undefined;
      try {
        const ref = interpretFull(c.program!);
        logging = await run(mustCompile(src), 'logging');
        rev = await run(mustCompile(src), 'reversible');
        if (logging.status !== 'halted') throw new Error(`logging engine: ${logging.status} ${logging.vm.lastError}`);
        if (rev.status !== 'halted') throw new Error(`reversible engine: ${rev.status}`);
        if (logging.steps !== rev.steps) throw new Error(`step counts differ: ${logging.steps} vs ${rev.steps}`);
        expect(Object.fromEntries(rev.vars)).toEqual(Object.fromEntries(ref.vars));
        const machine = rev; // a const, so the closures below see it as defined
        expect(readConsole((a, n) => machine.vm.memory(a, n))).toEqual(ref.console);
        expect(Object.fromEntries(logging.vars)).toEqual(Object.fromEntries(ref.vars));
        const regs = rev.vm.registers().regs;
        for (const reg of [8, 9, 10, 11, 12, 13, 15]) expect(regs[reg], `temporary r${reg}`).toBe(0);
        expect(regs[14]).toBe(0x10000);
        const t = rev.steps;
        expect(rev.vm.runTo(0)).toBe('ok');
        expect(rev.vm.registers().regs.every((x, k) => x === (k === 14 ? 0x10000 : 0))).toBe(true);
        expect(Array.from(rev.vm.memory(0, 0x20800)).every((x, k) => x === machine.startMem[k])).toBe(true);
        expect(rev.vm.runTo(t)).toBe('ok');
        expect(Object.fromEntries(rev.vars)).toEqual(Object.fromEntries(ref.vars));
      } catch (e) {
        bad.push(`seed ${seed}: ${(e as Error).message.split('\n')[0]}\n${src}`);
      } finally {
        logging?.vm.destroy(); // free the engines now: thousands of programs would exhaust the WebAssembly heap
        rev?.vm.destroy();
      }
    }
    if (bad.length) console.log(`FUZZ FAILURES (${bad.length} of ${compiled}):\n` + bad.slice(0, 3).join('\n----\n'));
    console.log(`fuzz: ${compiled} compiled and checked, ${skipped} skipped (out of temporaries), ${bad.length} failures`);
    expect(bad.length).toBe(0);
    expect(compiled).toBeGreaterThan(SEEDS / 5); // most random programs compile; the rest run out of temporary registers
  }, 3_000_000);
});
