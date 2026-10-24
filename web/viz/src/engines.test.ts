// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { assemble } from '../../../asm/src/index';
import sortSource from '../../../programs/sort.s?raw';
import { SAMPLES } from '../../mock_vm/src/index';
import { createWasmVm } from '../../wasm/src/index';
import type { AssembleFn } from './assembler';
import { asciiOf } from './panels/memory';
import { scanMemory } from './panels/compare';
import { inGarbage, inspectImage } from './program';
import { mountViz } from './shell';
import type { VizHandle } from './shell';

const assembleHook: AssembleFn = (source, fileName) => {
  const r = assemble(source, { fileName });
  return { ok: r.ok, image: r.image, diagnostics: r.diagnostics, listing: r.listing };
};
const loopImage = () => SAMPLES.find((s) => s.name === 'counting loop')!.build().image;
const programs = [{ name: 'counting loop', load: loopImage }];

let root: HTMLElement;
let viz: VizHandle;

beforeEach(async () => {
  HTMLCanvasElement.prototype.getContext = () => null;
  document.body.innerHTML = '<div id="app"></div>';
  root = document.getElementById('app')!;
  viz = mountViz(root, await createWasmVm('logging'), {
    programs,
    createVm: createWasmVm,
    engines: ['logging', 'reversible'],
    assemble: assembleHook,
  });
});

describe('engine switch', () => {
  it('replays the run on the other engine: same t, same state, no history', async () => {
    for (let i = 0; i < 12; i++) viz.step();
    viz.pushInput(0x41);
    for (let i = 0; i < 3; i++) viz.step();
    const before = viz.vm.registers();
    expect(viz.vm.kind).toBe('logging');
    expect(viz.vm.historyBytes).toBeGreaterThan(0);

    expect(await viz.setEngine('reversible')).toBe('ok');
    expect(viz.vm.kind).toBe('reversible');
    expect(viz.vm.instructionCount).toBe(15);
    expect(Array.from(viz.vm.registers().regs)).toEqual(Array.from(before.regs));
    expect(viz.vm.registers().pc).toBe(before.pc);
    expect(viz.vm.memory(0x30001, 1)[0]).toBe(1); // the key press came along
    expect(viz.vm.historyBytes).toBe(0);
    expect(root.querySelector('.history')!.getAttribute('data-engine')).toBe('reversible');
    expect(viz.machines).toHaveLength(1);
  });

  it('replays direction flips too', async () => {
    for (let i = 0; i < 8; i++) viz.step();
    viz.setDirection(-1);
    viz.step(); viz.step();
    const regs = Array.from(viz.vm.registers().regs);
    await viz.setEngine('reversible');
    expect(viz.vm.direction).toBe(-1);
    expect(viz.vm.instructionCount).toBe(10);
    expect(Array.from(viz.vm.registers().regs)).toEqual(regs);
  });

  it('refuses an engine the page cannot create', async () => {
    const lone = mountViz(document.createElement('div'), await createWasmVm('logging'), { programs });
    expect(await lone.setEngine('reversible')).toBe('bad_arg');
  });
});

describe('compare', () => {
  it('runs both engines in lockstep and reports a state match', async () => {
    expect(await viz.setCompare(true)).toBe('ok');
    expect(viz.machines.map((m) => m.vm.kind)).toEqual(['logging', 'reversible']);
    for (let i = 0; i < 20; i++) viz.step();
    expect(viz.machines.map((m) => m.vm.instructionCount)).toEqual([20, 20]);
    viz.stepBack(); viz.stepBack();
    expect(viz.machines.map((m) => m.vm.instructionCount)).toEqual([18, 18]);
    const badge = root.querySelector<HTMLElement>('.match-badge')!;
    expect(badge.dataset.state).toBe('match');
    expect(badge.textContent).toContain('match');
    const hist = [...root.querySelectorAll('.cmp-hist')].map((e) => e.textContent);
    expect(hist).toEqual(['864 B', '0 B']); // 18 steps x 48 B, and nothing
    await viz.setCompare(false);
    expect(viz.machines).toHaveLength(1);
  });

  it('detects a difference between the machines', async () => {
    await viz.setCompare(true);
    viz.step();
    viz.machines[1].vm.stepForward(); // push one machine out of step behind the shell's back
    viz.refresh();
    const badge = root.querySelector<HTMLElement>('.match-badge')!;
    expect(badge.dataset.state).toBe('diff');
    expect(badge.textContent).toContain('differ');
  });

  it('scanMemory finds the first differing word and counts used words', () => {
    expect(scanMemory([0, 1, 0, 2], [0, 1, 5, 2])).toEqual({ diff: 2, usedA: 2, usedB: 3 });
    expect(scanMemory([0, 0], [0, 0]).diff).toBe(-1);
  });
});

describe('assembler hook', () => {
  it('assembles, loads and shows the source; reports errors without touching the machine', () => {
    const ok = viz.assembleAndLoad('start: xori r1, 7\n hlt\n', 'tiny');
    expect(ok.ok).toBe(true);
    expect(viz.program?.name).toBe('tiny');
    expect(viz.program?.source).toContain('xori r1, 7');
    viz.step();
    expect(viz.vm.registers().regs[1]).toBe(7);
    const bad = viz.assembleAndLoad('start: add r1, r1\n', 'bad');
    expect(bad.ok).toBe(false);
    expect(bad.diagnostics[0].severity).toBe('error');
    expect(viz.program?.name).toBe('tiny');
  });
});

describe('garbage and ASCII', () => {
  it('finds the sort program\'s garbage array from its data label', () => {
    const r = assemble(sortSource);
    const info = inspectImage('sort', r.image!);
    expect(info.garbage).toEqual([[8, 27]]);
    expect(inGarbage(info, 8)).toBe(true);
    expect(inGarbage(info, 26)).toBe(true);
    expect(inGarbage(info, 27)).toBe(false);
    expect(inGarbage(info, 7)).toBe(false);
    expect(info.dataLabels.map((l) => l.name)).toEqual(['arr', 'garbage']);
  });

  it('shows a word as four little-endian characters', () => {
    expect(asciiOf(0x48544f4e)).toBe('NOTH');
    expect(asciiOf(0x00410100)).toBe('··A·');
  });
});
