// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { assemble } from '../../../asm/src/index';
import { createWasmVm } from '../../wasm/src/index';
import type { AssembleFn } from './assembler';
import { ADD_TWO_NUMBERS } from './examples';
import { tokenize, tokenizeLine } from './highlight';
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

  for (const kind of ['logging', 'reversible'] as const) {
    it(`adds two typed numbers on the ${kind} engine, and running back undoes all of it`, async () => {
      await mount(kind);
      expect(viz.assembleAndLoad(ADD_TWO_NUMBERS, 'add two numbers').ok).toBe(true);
      const start = { regs: regs(), pc: viz.vm.registers().pc };
      viz.pushInput(7);
      viz.pushInput(5);
      for (let i = 0; i < 7; i++) expect(viz.step()).toBe('ok');
      expect(data()).toEqual([7, 5, 12]); // first, second, sum
      expect(regs()[2]).toBe(12); // r2 holds the sum
      expect(viz.step()).toBe('halted');

      for (let i = 0; i < 7; i++) expect(viz.stepBack()).toBe('ok');
      expect(data()).toEqual([0, 0, 0]);
      expect(regs()).toEqual(start.regs);
      expect(viz.vm.registers().pc).toBe(start.pc);
      expect(viz.vm.historyBytes).toBe(kind === 'logging' ? 0 : 0); // stepped back to t = 0: no history left either way
    });
  }

  it('the reversible engine rewinds it with no history at all', async () => {
    await mount('reversible');
    viz.assembleAndLoad(ADD_TWO_NUMBERS, 'add two numbers');
    viz.pushInput(40);
    viz.pushInput(2);
    for (let i = 0; i < 7; i++) viz.step();
    expect(Array.from(viz.vm.memory(0, 3))).toEqual([40, 2, 42]);
    expect(viz.vm.historyBytes).toBe(0); // nothing per step (typed numbers are on the input tape, not in history)
    for (let i = 0; i < 3; i++) viz.stepBack();
    expect(Array.from(viz.vm.memory(0, 3))).toEqual([40, 0, 0]); // sum and second are un-stored, first is still there
  });

  it('a number sent after the step that reads it is invisible to that step (the input is time-gated)', async () => {
    await mount();
    viz.assembleAndLoad(ADD_TWO_NUMBERS, 'add two numbers');
    for (let i = 0; i < 3; i++) viz.step(); // xori, xld, xld have run
    viz.pushInput(9);
    for (let i = 0; i < 4; i++) viz.step();
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
    expect(syn.querySelector('.tok-flow')!.textContent).toBe('hlt');
    expect(syn.querySelector('.tok-label')!.textContent).toBe('first');
  });

  it('recolours as you type', () => {
    const ta = root.querySelector<HTMLTextAreaElement>('.ed-text')!;
    ta.value = 'start: nop\n hlt\n';
    ta.dispatchEvent(new Event('input'));
    expect(root.querySelector('.ed-syn')!.textContent).toBe(ta.value);
    expect(root.querySelector('.ed-syn .tok-op')!.textContent).toBe('nop');
  });

  it('numbers the memory rows in decimal', () => {
    const rows = [...root.querySelectorAll('.vis-mem .lw')].map((w) => [...w.querySelectorAll('.lw-addr')].map((e) => e.textContent));
    expect(rows[0].slice(0, 3)).toEqual(['0', '4', '8']); // data memory
    expect(rows[1].slice(0, 2)).toEqual(['65536', '65540']); // stack
    expect(root.querySelector('.vis-mem')!.textContent).toContain('Stack from 65536');
  });
});
