// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockVm, LoggingVm, SAMPLES } from '../../mock_vm/src/index';
import type { RVM } from '../../../spec/vm_api';
import { mountViz } from './shell';
import type { UpdateEvent, VizHandle } from './shell';

const programs = SAMPLES.map((s) => ({ name: s.name, load: () => s.build().image }));
const loopIndex = SAMPLES.findIndex((s) => s.name === 'counting loop');

let root: HTMLElement;
let vm: RVM;
let viz: VizHandle;

beforeEach(async () => {
  HTMLCanvasElement.prototype.getContext = () => null; // jsdom has no canvas; the panel copes with null
  document.body.innerHTML = '<div id="app"></div>';
  root = document.getElementById('app')!;
  vm = await createMockVm('logging');
  viz = mountViz(root, vm, { programs, initialProgram: loopIndex });
});

describe('shell', () => {
  it('mounts the slots and loads the first program', () => {
    for (const k of ['toolbar', 'timeline', 'side', 'left', 'code'] as const) expect(root.contains(viz.slots[k])).toBe(true);
    expect(viz.program?.name).toBe('counting loop');
    expect(viz.snapshot.t).toBe(0);
    expect(viz.machines).toHaveLength(1);
    expect(viz.machines[0].vm).toBe(vm);
  });

  it('update events carry t, maxT, branch and direction', () => {
    const seen: UpdateEvent[] = [];
    viz.on('update', (e) => seen.push(e));
    viz.step();
    viz.step();
    const e = seen[seen.length - 1];
    expect([e.t, e.maxT, e.branch, e.direction]).toEqual([2, 2, false, 1]);
    viz.stepBack();
    expect(seen[seen.length - 1]).toMatchObject({ t: 1, maxT: 2, branch: false });
  });

  it('a host action after scrubbing back starts a new branch and resets maxT', () => {
    viz.step(); viz.step(); viz.step();
    viz.stepBack(); viz.stepBack(); // t = 1, maxT = 3
    expect(viz.maxT).toBe(3);
    viz.setDirection(-1);
    expect(viz.branch).toBe(true);
    expect(viz.maxT).toBe(1);
    expect(viz.snapshot.direction).toBe(-1);
    expect(root.dataset.dir).toBe('rev');
  });

  it('a host action at maxT is not a fork; load clears the branch flag', () => {
    viz.step();
    viz.pushInput(0x41);
    expect(viz.branch).toBe(false);
    viz.step(); viz.stepBack(); viz.stepBack();
    viz.pushInput(0x41);
    expect(viz.branch).toBe(true);
    viz.reset();
    expect(viz.branch).toBe(false);
    expect(viz.maxT).toBe(0);
  });

  it('emits load and run events', () => {
    const load = vi.fn();
    const run = vi.fn();
    viz.on('load', load);
    viz.on('run', run);
    viz.reset();
    expect(load).toHaveBeenCalledOnce();
    viz.run();
    viz.pause();
    expect(run.mock.calls.map((c) => c[0].mode)).toEqual(['forward', null]);
  });

  it('applies every action to every machine in the list', () => {
    const second = new LoggingVm();
    (viz.machines as { label: string; vm: RVM }[]).push({ label: 'second', vm: second });
    viz.loadImage('x', SAMPLES[loopIndex].build().image);
    viz.step();
    expect(second.instructionCount).toBe(1);
    viz.stepBack();
    expect(second.instructionCount).toBe(0);
  });
});

describe('built-in controls', () => {
  it('setBuiltinControls writes the override attribute the stylesheet reads (hiding itself is CSS)', () => {
    viz.setBuiltinControls('off');
    expect(root.dataset.builtinControls).toBe('off');
    viz.setBuiltinControls('on');
    expect(root.dataset.builtinControls).toBe('on');
    viz.setBuiltinControls('auto');
    expect(root.dataset.builtinControls).toBeUndefined();
  });
});

describe('editor hooks', () => {
  // the mock samples have no source, so the editor shows their disassembly: line n is the instruction at address n - 1
  const gutterRow = (line: number) => root.querySelector<HTMLElement>(`.ed-ln[data-line="${line}"]`)!;
  const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

  it('reports clicks with the code address and whether the gutter was hit', () => {
    const clicks: { addr: number; gutter: boolean }[] = [];
    viz.listing.onLineClick((e) => clicks.push({ addr: e.addr, gutter: e.gutter }));
    gutterRow(4).click(); // the gutter of line 4 = address 3
    const text = root.querySelector<HTMLTextAreaElement>('.ed-text')!;
    const offset = text.value.split('\n').slice(0, 2).join('\n').length + 3; // inside line 3
    text.setSelectionRange(offset, offset);
    text.click();
    expect(clicks).toEqual([{ addr: 3, gutter: true }, { addr: 2, gutter: false }]);
  });

  it('draws breakpoints, the culprit line and the current instruction', async () => {
    viz.listing.setBreakpoints([1, 4]);
    viz.listing.setCulprit(2);
    expect(gutterRow(2).classList.contains('bp')).toBe(true);
    expect(gutterRow(5).classList.contains('bp')).toBe(true);
    expect(gutterRow(3).classList.contains('bp')).toBe(false);
    const culprit = root.querySelector<HTMLElement>('.ed-culprit')!;
    expect(culprit.hidden).toBe(false);
    expect(culprit.style.top).toBe('40px'); // line 3, 20px per line
    expect(gutterRow(1).classList.contains('now')).toBe(true); // pc = entry = 0 at t = 0
    viz.listing.setBreakpoints([]);
    viz.listing.setCulprit(null);
    await frame();
    expect(root.querySelectorAll('.ed-ln.bp')).toHaveLength(0);
    expect(root.querySelector<HTMLElement>('.ed-culprit')!.hidden).toBe(true);
  });

  it('moves the current-line marker as the machine runs', () => {
    viz.step(); viz.step();
    const now = root.querySelector<HTMLElement>('.ed-ln.now')!;
    expect(now.dataset.line).toBe(String(viz.snapshot.pc + 1));
  });

  it('with nobody listening, a gutter click toggles a breakpoint; once someone listens it does not', () => {
    gutterRow(3).click();
    expect(gutterRow(3).classList.contains('bp')).toBe(true);
    gutterRow(3).click();
    expect(gutterRow(3).classList.contains('bp')).toBe(false);
    viz.listing.onLineClick(() => {});
    gutterRow(3).click();
    expect(gutterRow(3).classList.contains('bp')).toBe(false);
  });
});

describe('layout', () => {
  it('has three tabs on the right and an editor with the debug bar on the left', () => {
    const tabs = [...root.querySelectorAll('.work > .tabs .tab')].map((t) => t.textContent);
    expect(tabs).toEqual(['Visualisation', 'Output', 'Compare']);
    expect(root.querySelector('.ide .editor')).not.toBeNull();
    expect(root.querySelector('.ide .debugbar .transport')).not.toBeNull();
    expect(root.querySelector('.debugbar .tbar-track')).not.toBeNull();
  });

  it('the editor and debug controls collapse completely, with the button and with Ctrl+B', () => {
    expect(root.dataset.ide).toBe('open');
    root.querySelector<HTMLButtonElement>('.divider-btn')!.click();
    expect(root.dataset.ide).toBe('closed');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true }));
    expect(root.dataset.ide).toBe('open');
  });

  it('the Output tab is the console, the screen and the input boxes: no registers, no memory', () => {
    expect(root.querySelector('.out .screen')).not.toBeNull();
    expect(root.querySelector('.out .numin')).not.toBeNull();
    expect(root.querySelector('.out .capture')).not.toBeNull();
    expect(root.querySelector('.out .reg-grid')).toBeNull();
    expect(root.querySelector('.out .hexgrid')).toBeNull();
    expect(root.querySelector('.out .values')).toBeNull();
  });
});

describe('keys', () => {
  it('only reach the machine while the Output tab (the screen) is open', () => {
    const press = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    const tab = (i: number) => root.querySelectorAll<HTMLButtonElement>('.work > .tabs .tab')[i].click();
    tab(0); // Visualisation
    press();
    expect(vm.memory(0x30001, 1)[0]).toBe(0);
    tab(1); // Output
    press();
    expect(vm.memory(0x30001, 1)[0]).toBe(1); // COUNT
    tab(0);
    press();
    expect(vm.memory(0x30001, 1)[0]).toBe(1); // unchanged
  });
});
