// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { assemble } from '../../../asm/src/index';
import { createWasmVm } from '../../wasm/src/index';
import type { AssembleFn } from './assembler';
import { ADD_TWO_NUMBERS } from './examples';
import { tokenize, tokenizeLine } from './highlight';
import { consoleText } from '../../../lang/src/console';
import { parseNumber } from './panels/numberinput';
import { mountViz } from './shell';
import type { VizHandle } from './shell';

const assembleHook: AssembleFn = (source, fileName) => {
  const r = assemble(source, { fileName });
  return { ok: r.ok, image: r.image, diagnostics: r.diagnostics, listing: r.listing };
};
const kinds = (line: string) => tokenizeLine(line).filter((t) => t.kind !== 'plain').map((t) => `${t.kind}:${t.text}`);

describe('syntax highlighting', () => {
  it('colours labels, instructions, registers, numbers, conditions, directives and comments', () => {
    expect(kinds('start:  addi r1, -5   ; limit')).toEqual(['label:start', 'op:addi', 'register:r1', 'number:-5', 'comment:; limit']);
    expect(kinds('        br   eq, r1, r2, Lthen')).toEqual(['flow:br', 'cond:eq', 'register:r1', 'register:r2']);
    expect(kinds('        .loop ne, sp, r0')).toEqual(['directive:.loop', 'cond:ne', 'register:sp', 'register:r0']);
    expect(kinds('        xld r2, [r1+0x2]')).toEqual(['op:xld', 'register:r2', 'register:r1', 'number:0x2']);
    expect(kinds('; whole line comment')).toEqual(['comment:; whole line comment']);
  });

  it('keeps the text exactly (the coloured copy must line up with the textarea) and tokenizes every line', () => {
    const src = ADD_TWO_NUMBERS;
    const rebuilt = tokenize(src).map((line) => line.map((t) => t.text).join('')).join('\n');
    expect(rebuilt).toBe(src);
    expect(tokenize(src)).toHaveLength(src.split('\n').length);
  });

  it('does not take a mid-line word for a label', () => {
    expect(kinds('  addi r1, start')).toEqual(['op:addi', 'register:r1']);
  });
});

describe('parseNumber', () => {
  it('accepts decimal and hex, negatives as two\'s complement, and rejects the rest', () => {
    expect(parseNumber(' 42 ')).toBe(42);
    expect(parseNumber('0xff')).toBe(255);
    expect(parseNumber('-1')).toBe(0xffffffff);
    expect(parseNumber('4294967295')).toBe(0xffffffff);
    expect(parseNumber('4294967296')).toBeNull();
    expect(parseNumber('1.5')).toBeNull();
    expect(parseNumber('seven')).toBeNull();
    expect(parseNumber('')).toBeNull();
  });
});

let root: HTMLElement;
let viz: VizHandle;

async function mount(kind: 'logging' | 'reversible' = 'logging'): Promise<void> {
  HTMLCanvasElement.prototype.getContext = () => null;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.hasPointerCapture = () => true;
  Element.prototype.releasePointerCapture = () => {};
  localStorage.clear();
  document.body.innerHTML = '<div id="app"></div>';
  root = document.getElementById('app')!;
  viz = mountViz(root, await createWasmVm(kind), { createVm: createWasmVm, engines: ['logging', 'reversible'], assemble: assembleHook });
}

describe('add two numbers (a program that reads the user\'s input)', () => {
  const regs = () => Array.from(viz.vm.registers().regs);
  const data = () => Array.from(viz.vm.memory(0, 3));
  const text = () => consoleText((a, n) => viz.vm.memory(a, n));
  /** Step until the program halts; returns how many instructions that took. */
  const runToHalt = (): number => {
    let n = 0;
    while (viz.step() === 'ok') n++;
    return n;
  };

  for (const kind of ['logging', 'reversible'] as const) {
    it(`adds two typed numbers on the ${kind} engine, prints them, and running back undoes all of it`, async () => {
      await mount(kind);
      expect(viz.assembleAndLoad(ADD_TWO_NUMBERS, 'add two numbers').ok).toBe(true);
      const start = { regs: regs(), pc: viz.vm.registers().pc };
      viz.pushInput(7);
      viz.pushInput(5);
      const n = runToHalt();
      expect(n).toBeGreaterThan(40);
      expect(data()).toEqual([7, 5, 12]); // first, second, sum
      expect(regs()[2]).toBe(12); // r2 holds the sum
      expect(text()).toBe('7\n5\n12\n'); // the inputs and the sum, one per line

      for (let i = 0; i < n; i++) expect(viz.stepBack()).toBe('ok');
      expect(data()).toEqual([0, 0, 0]);
      expect(text()).toBe(''); // un-printed
      expect(regs()).toEqual(start.regs);
      expect(viz.vm.registers().pc).toBe(start.pc);
      expect(viz.vm.historyBytes).toBe(0); // stepped back to t = 0: no history left either way
    });
  }

  it('the reversible engine rewinds it with no history at all', async () => {
    await mount('reversible');
    viz.assembleAndLoad(ADD_TWO_NUMBERS, 'add two numbers');
    viz.pushInput(40);
    viz.pushInput(2);
    const n = runToHalt();
    expect(Array.from(viz.vm.memory(0, 3))).toEqual([40, 2, 42]);
    expect(text()).toBe('40\n2\n42\n');
    expect(viz.vm.historyBytes).toBe(0); // nothing per step (typed numbers are on the input tape, not in history)
    for (let i = 0; i < n; i++) viz.stepBack();
    expect(Array.from(viz.vm.memory(0, 3))).toEqual([0, 0, 0]);
  });

  it('a number sent after the step that reads it is invisible to that step (the input is time-gated)', async () => {
    await mount();
    viz.assembleAndLoad(ADD_TWO_NUMBERS, 'add two numbers');
    for (let i = 0; i < 3; i++) viz.step(); // xori, xld, xld have run
    viz.pushInput(9);
    runToHalt();
    expect(Array.from(viz.vm.memory(0, 3))).toEqual([0, 0, 0]);
  });

  it('the send box puts numbers on the input tape and shows what the window holds', async () => {
    await mount();
    viz.assembleAndLoad(ADD_TWO_NUMBERS, 'add two numbers');
    const form = root.querySelector<HTMLFormElement>('.vis .numin')!;
    const field = form.querySelector<HTMLInputElement>('.numin-field')!;
    const send = (v: string) => { field.value = v; form.dispatchEvent(new Event('submit', { cancelable: true })); };
    send('7');
    send('5');
    send('nope');
    expect(form.querySelector<HTMLElement>('.numin-error')!.hidden).toBe(false);
    viz.refresh();
    expect(form.querySelector('.numin-seen')!.textContent).toContain('2 numbers: 7, 5');
    expect(Array.from(viz.vm.memory(0x30002, 2))).toEqual([7, 5]);
  });

  it('the Output tab shows the console only once the program has printed, with Lock scroll and no Copy', async () => {
    await mount();
    viz.assembleAndLoad(ADD_TWO_NUMBERS, 'add two numbers');
    root.querySelectorAll<HTMLButtonElement>('.work > .tabs .tab')[1].click();
    const consoleEl = root.querySelector<HTMLElement>('.out .console')!;
    expect(consoleEl.hidden).toBe(true);
    viz.pushInput(3);
    viz.pushInput(4);
    runToHalt();
    expect(consoleEl.hidden).toBe(false);
    expect([...consoleEl.querySelectorAll('.console-line')].map((l) => l.textContent)).toEqual(['3', '4', '7', ' ']);
    expect(consoleEl.querySelector('.console-lock')).not.toBeNull();
    expect(consoleEl.textContent).not.toMatch(/copy|clear/i);
  });
});

describe('the divider', () => {
  beforeEach(async () => { await mount(); });

  it('the collapse button sits on the divider, not in the header', () => {
    expect(root.querySelector('.viz-header .sidebar-btn')).toBeNull();
    const btn = root.querySelector<HTMLButtonElement>('.divider .divider-btn')!;
    expect(root.dataset.ide).toBe('open');
    btn.click();
    expect(root.dataset.ide).toBe('closed');
    expect(btn.getAttribute('aria-label')).toBe('Show the editor');
    btn.click();
    expect(root.dataset.ide).toBe('open');
    expect(btn.getAttribute('aria-label')).toBe('Hide the editor');
  });

  it('dragging resizes the editor (within limits), double-click resets it, and the width is remembered', () => {
    Object.defineProperty(root.querySelector('.split')!, 'clientWidth', { value: 1000 }); // jsdom does no layout
    const divider = root.querySelector<HTMLElement>('.divider')!;
    const move = (x: number) => divider.dispatchEvent(Object.assign(new MouseEvent('pointermove', { clientX: x, bubbles: true }), { pointerId: 1 }));
    divider.dispatchEvent(Object.assign(new MouseEvent('pointerdown', { clientX: 400, bubbles: true }), { pointerId: 1 }));
    move(300);
    expect(root.style.getPropertyValue('--ide-w')).toBe('300px');
    move(50);
    expect(root.style.getPropertyValue('--ide-w')).toBe('260px'); // never narrower than 260px
    expect(localStorage.getItem('viz.ideW')).toBe('260');
    divider.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(root.style.getPropertyValue('--ide-w')).toBe('');
    expect(localStorage.getItem('viz.ideW')).toBeNull();
  });

  it('does not resize while the editor is collapsed', () => {
    root.querySelector<HTMLButtonElement>('.divider-btn')!.click();
    const divider = root.querySelector<HTMLElement>('.divider')!;
    divider.dispatchEvent(Object.assign(new MouseEvent('pointerdown', { clientX: 5, bubbles: true }), { pointerId: 1 }));
    divider.dispatchEvent(Object.assign(new MouseEvent('pointermove', { clientX: 500, bubbles: true }), { pointerId: 1 }));
    expect(root.style.getPropertyValue('--ide-w')).toBe('');
  });
});

describe('editor colours and the visualisation tables', () => {
  beforeEach(async () => { await mount(); viz.assembleAndLoad(ADD_TWO_NUMBERS, 'add two numbers'); });

  it('draws a coloured copy of the source behind the textarea', () => {
    const syn = root.querySelector('.ed-syn')!;
    expect(syn.textContent).toBe(root.querySelector<HTMLTextAreaElement>('.ed-text')!.value);
    expect(syn.querySelectorAll('.tok-comment').length).toBeGreaterThan(3);
    expect(syn.querySelector('.tok-op')!.textContent).toBe('xori');
    expect(syn.querySelector('.tok-flow')!.textContent).toBe('call');
    expect(syn.querySelector('.tok-label')!.textContent).toBe('first');
  });

  it('recolours as you type', () => {
    const ta = root.querySelector<HTMLTextAreaElement>('.ed-text')!;
    ta.value = 'start: nop\n hlt\n';
    ta.dispatchEvent(new Event('input'));
    expect(root.querySelector('.ed-syn')!.textContent).toBe(ta.value);
    expect(root.querySelector('.ed-syn .tok-op')!.textContent).toBe('nop');
  });

  it('one main memory: program, data and stack, with a lettered, zero-padded row number on every row', () => {
    const labels = (sel: string) => [...root.querySelectorAll(sel)].map((e) => e.textContent);
    expect(labels('.vis .mm-head span:first-child')).toEqual(['Program', 'Data', 'Stack']);
    expect(labels('.vis .mm-prow .mm-addr').slice(0, 3)).toEqual(['P00000', 'P00001', 'P00002']);
    const words = [...root.querySelectorAll('.vis .mm-words')].map((w) => [...w.querySelectorAll('.mm-addr')].map((e) => e.textContent));
    expect(words[0].slice(0, 3)).toEqual(['D00000', 'D00004', 'D00008']);
    expect(words[1].slice(0, 2)).toEqual(['S65536', 'S65540']);
    expect(new Set(words.flat().map((l) => l!.length)).size).toBe(1); // every label the same width
    expect(root.querySelector('.vis .mm-prow .mm-hex')!.textContent).toMatch(/^0x[0-9a-f]{8}$/);
    expect(root.querySelector('.vis .mm')!.textContent).toContain('Harvard architecture, by design');
  });

  it('has no hex or unsigned choices: numbers are signed decimal', () => {
    expect(root.querySelector('.vis select[aria-label="number format"]')).toBeNull();
    expect(root.querySelector('.vis')!.textContent).not.toMatch(/unsigned/i);
  });
});
