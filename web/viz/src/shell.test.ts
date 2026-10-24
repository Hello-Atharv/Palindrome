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

describe('listing hooks', () => {
  it('reports clicks with the code address and whether the gutter was hit', () => {
    const clicks: { addr: number; gutter: boolean }[] = [];
    viz.listing.onLineClick((e) => clicks.push({ addr: e.addr, gutter: e.gutter }));
    const rows = root.querySelectorAll<HTMLElement>('.dis-row:not([hidden])');
    expect(rows.length).toBeGreaterThan(3);
    rows[2].querySelector<HTMLElement>('.dis-mn')!.click();
    rows[3].querySelector<HTMLElement>('.dis-gutter')!.click();
    expect(clicks).toEqual([{ addr: 2, gutter: false }, { addr: 3, gutter: true }]);
  });

  it('draws breakpoints, the culprit and the PC marker', async () => {
    viz.listing.setBreakpoints([1, 4]);
    viz.listing.setCulprit(2);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const cls = (a: number) => root.querySelector<HTMLElement>(`.dis-row[data-addr="${a}"]`)!.className;
    expect(cls(1)).toContain('bp');
    expect(cls(4)).toContain('bp');
    expect(cls(2)).toContain('culprit');
    expect(cls(0)).toContain('current'); // pc = entry = 0 at t = 0
    expect(cls(3)).not.toContain('bp');
    viz.listing.setBreakpoints([]);
    viz.listing.setCulprit(null);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(cls(1)).not.toContain('bp');
    expect(cls(2)).not.toContain('culprit');
  });

  it('moves the PC marker as the machine runs', () => {
    viz.step(); viz.step();
    const current = root.querySelector<HTMLElement>('.dis-row.current')!;
    expect(current.dataset.addr).toBe(String(viz.snapshot.pc));
  });
});

describe('keys', () => {
  it('only reach the machine while the Screen tab is open', () => {
    const press = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    root.querySelectorAll<HTMLButtonElement>('.viz-col > .tabs .tab')[0].click(); // Screen
    press();
    expect(vm.memory(0x30001, 1)[0]).toBe(1); // COUNT
    root.querySelectorAll<HTMLButtonElement>('.viz-col > .tabs .tab')[1].click(); // Memory
    press();
    expect(vm.memory(0x30001, 1)[0]).toBe(1); // unchanged
  });
});
