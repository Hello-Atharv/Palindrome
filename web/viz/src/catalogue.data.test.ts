// @vitest-environment node
// The picker's data: every program is rev, its .s is the compiler's own output, and every version builds and loads on both real engines.
import { describe, expect, it } from 'vitest';
import { compile } from '../../../lang/src/compile';
import { consoleText } from '../../../lang/src/console';
import { createWasmVm } from '../../wasm/src/index';
import { assembleHook, compileHook, programs } from './catalogue';
import { inspectImage, learnVerdict } from './program';
import type { ProgramEntry } from './program';

const both = (e: ProgramEntry): ProgramEntry[] => [e, e.alt!];

describe('the catalogue', () => {
  it('the small teaching programs stay small enough to animate in the Visualisation tab (a print costs about 13 instructions a character, so they must not print)', () => {
    const teaching = ['if / else', 'loop', 'nested loop', 'call / return', 'memory', 'bennett', 'my program', 'gradient', 'sort of three'];
    for (const name of teaching) {
      const p = programs.find((x) => x.name === name)!;
      for (const e of [p, p.alt!]) {
        const verdict = learnVerdict(inspectImage(e.name, e.load(), e.source));
        expect(verdict.ok, `${e.name}: ${verdict.why}`).toBe(true);
      }
    }
  });

  it('a program behaves the same whichever language you view it in: same game settings, same speed, same machine code', () => {
    for (const p of programs) {
      expect(p.alt!.game, p.name).toBe(p.game); // Pong keeps its frame stepping and its key-log note on the .s
      expect(p.alt!.speed, p.name).toBe(p.speed);
      expect(p.alt!.blurb, p.name).toBe(p.blurb);
      expect(Array.from(p.alt!.load()), p.name).toEqual(Array.from(p.load()));
    }
  });

  it('fibonacci prints its numbers (the console is memory, so stepping back un-prints them)', async () => {
    const vm = await createWasmVm('reversible');
    const fib = programs.find((p) => p.name === 'fibonacci')!;
    expect(vm.loadProgram(fib.load())).toBe('ok');
    expect(vm.runTo(1_000_000)).toBe('halted');
    expect(consoleText((a, n) => vm.memory(a, n))).toBe(['1', '1', '2', '3', '5', '8', '13', '21', '34', '55'].map((v, i) => `fib(${i + 1}) = ${v}
`).join(''));
    expect(vm.runTo(0)).toBe('ok');
    expect(consoleText((a, n) => vm.memory(a, n))).toBe('');
    (vm as { destroy?: () => void }).destroy?.();
  });

  it('has every example from examples/asm, examples/demos and examples/rev', () => {
    expect(programs.map((p) => p.name)).toEqual([
      'if / else', 'add two numbers', 'loop', 'nested loop', 'call / return', 'memory', 'bennett', 'my program',
      'sort', 'cipher', 'pong', 'gradient', 'hello', 'fibonacci', 'sort of three', 'tour',
    ]);
  });

  it('gives every program a twin in the other language, pointing back, with a name of its own', () => {
    const names = programs.flatMap(both).map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    for (const p of programs) {
      expect(p.alt, p.name).toBeDefined();
      expect(p.alt!.alt).toBe(p);
      expect([p.language ?? 'asm', p.alt!.language ?? 'asm'].sort()).toEqual(['asm', 'rev']); // one of each
      expect(p.source!.length).toBeGreaterThan(20);
      expect(p.alt!.source!.length).toBeGreaterThan(20);
    }
  });

  it('every version builds, with no compiler or assembler errors', () => {
    for (const p of programs.flatMap(both)) {
      const out = (p.language === 'rev' ? compileHook : assembleHook)(p.source!, p.name);
      expect(out.diagnostics.filter((d) => d.severity === 'error'), p.name).toEqual([]);
      expect(out.ok, p.name).toBe(true);
      expect(p.load().byteLength, p.name).toBeGreaterThan(32);
    }
  });

  it('every version loads on both engines', async () => {
    for (const kind of ['logging', 'reversible'] as const) {
      const vm = await createWasmVm(kind);
      for (const p of programs.flatMap(both)) expect(vm.loadProgram(p.load()), `${p.name} on ${kind}`).toBe('ok');
      (vm as { destroy?: () => void }).destroy?.();
    }
  });

  it('every .s is written by the rev compiler, says so, and assembles to the same code as the compiler made', () => {
    const generated = programs.flatMap(both).filter((p) => p.generatedFrom);
    expect(generated.map((p) => p.name)).toEqual(programs.map((p) => `${p.name} (asm)`)); // the .s of EVERY program is generated: they cannot disagree
    for (const p of generated) {
      const rev = p.alt!;
      expect(Array.from(p.load()), p.name).toEqual(Array.from(compile(rev.source!).image!));
      expect(p.generatedFrom).toBe(`${rev.name}.rev`);
    }
  });
});
