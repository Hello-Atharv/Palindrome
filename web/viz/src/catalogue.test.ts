// @vitest-environment jsdom
// The picker: every program is viewable in both .rev and .s, and every version loads on both real engines.
import { describe, expect, it } from 'vitest';
import { compile } from '../../../lang/src/compile';
import { createWasmVm } from '../../wasm/src/index';
import { assembleHook, compileHook, programs } from './catalogue';
import type { ProgramEntry } from './program';
import { mountViz } from './shell';

const both = (e: ProgramEntry): ProgramEntry[] => [e, e.alt!];

describe('the catalogue', () => {
  it('has every example from examples/asm, examples/demos and examples/rev', () => {
    expect(programs.map((p) => p.name)).toEqual([
      'if / else', 'if / else (no macros)', 'add two numbers', 'loop', 'loop (no macros)', 'nested loop', 'call / return', 'memory', 'bennett', 'my program',
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

  it('a .s written by the rev compiler says so, and assembles to the same code as the compiler made', () => {
    const generated = programs.flatMap(both).filter((p) => p.generatedFrom);
    expect(generated.map((p) => p.name)).toEqual(['hello (asm)', 'fibonacci (asm)', 'sort of three (asm)', 'tour (asm)']);
    for (const p of generated) {
      const rev = p.alt!;
      expect(Array.from(p.load()), p.name).toEqual(Array.from(compile(rev.source!).image!));
      expect(p.generatedFrom).toBe(`${rev.name}.rev`);
    }
  });
});

describe('viewing a program in both languages', () => {
  async function mount() {
    HTMLCanvasElement.prototype.getContext = () => null;
    Element.prototype.setPointerCapture = () => {};
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const viz = mountViz(root, await createWasmVm('logging'), { programs, createVm: createWasmVm, engines: ['logging', 'reversible'], assemble: assembleHook, compile: compileHook });
    const pick = (name: string) => {
      const select = root.querySelector<HTMLSelectElement>('.viz-header .program-select')!;
      select.value = String(programs.findIndex((p) => p.name === name));
      select.dispatchEvent(new Event('change'));
    };
    const lang = (l: '.s' | '.rev') => [...root.querySelectorAll<HTMLButtonElement>('.variant .seg')].find((b) => b.textContent === l)!.click();
    return { root, viz, pick, lang, file: () => root.querySelector<HTMLElement>('.ed-file')!.textContent };
  }

  it('every program shows the .s | .rev switch, and switching shows the other source under the right file name', async () => {
    const { root, pick, lang, file } = await mount();
    for (const p of programs) {
      pick(p.name);
      expect(root.querySelector('.variant')!.classList.contains('off'), p.name).toBe(false);
      const first = (p.language ?? 'asm') === 'rev' ? '.rev' : '.s';
      const other = first === '.rev' ? '.s' : '.rev';
      expect(file(), p.name).toContain(first);
      const before = root.querySelector<HTMLTextAreaElement>('.ed-text')!.value;
      lang(other);
      expect(root.querySelector<HTMLTextAreaElement>('.ed-text')!.value, p.name).not.toBe(before);
      expect(file(), p.name).toContain(other);
      lang(first as '.s' | '.rev');
      expect(root.querySelector<HTMLTextAreaElement>('.ed-text')!.value, p.name).toBe(before);
    }
  });

  it('the .s of a rev program is labelled as generated, and a hand-written .s is not', async () => {
    const { pick, lang, file } = await mount();
    pick('hello');
    expect(file()).toBe('hello.rev');
    lang('.s');
    expect(file()).toBe('hello.s (generated)');
    pick('loop');
    expect(file()).toBe('loop.s');
    lang('.rev');
    expect(file()).toBe('loop.rev');
  });
});
