// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { assemble } from '../../../asm/src/index';
import { SAMPLES } from '../../mock_vm/src/index';
import { createWasmVm } from '../../wasm/src/index';
import type { AssembleFn } from './assembler';
import { scanMemory, totalBits } from './panels/compare';
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
    expect(root.querySelector('.dbg-hist')!.textContent).toBe('Reversible history 0 B');
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
    expect(root.querySelector<HTMLElement>('.cmp-mismatch')!.hidden).toBe(true);
    const hist = [...root.querySelectorAll('.cmp-card')].map((c) => c.querySelector('.cmp-stats dd')!.textContent);
    expect(hist).toEqual(['864 B', '0 B']); // 18 steps x 48 B, and nothing
    expect([...root.querySelectorAll('.cmp-title')].map((e) => e.textContent)).toEqual(['Naive diary', 'Reversible']);
    await viz.setCompare(false);
    expect(viz.machines).toHaveLength(1);
  });

  it('detects a difference between the machines', async () => {
    await viz.setCompare(true);
    viz.step();
    viz.machines[1].vm.stepForward(); // push one machine out of step behind the shell's back
    viz.refresh();
    const line = root.querySelector<HTMLElement>('.cmp-mismatch')!;
    expect(line.hidden).toBe(false);
    expect(line.textContent).toContain('differ');
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
    const r = assemble(['.data', 'arr: .word 1,2,3,4,5,6,7,8', 'garbage: .space 19', '.code', 'start: hlt', ''].join('\n'));
    const info = inspectImage('sort', r.image!);
    expect(info.garbage).toEqual([[8, 27]]);
    expect(inGarbage(info, 8)).toBe(true);
    expect(inGarbage(info, 26)).toBe(true);
    expect(inGarbage(info, 27)).toBe(false);
    expect(inGarbage(info, 7)).toBe(false);
    expect(info.dataLabels.map((l) => l.name)).toEqual(['arr', 'garbage']);
  });

  it('counts garbage as 32 bits per non-zero word, the console buffer included', async () => {
    const { garbageBitsOf } = await import('./track');
    const vm = await createWasmVm('reversible');
    const r = assemble(['.data', 'garbage: .space 4', '.code', 'start: xori r1, 5', 'xst r1, [r0+1]', 'hlt', ''].join('\n'));
    vm.loadProgram(r.image!);
    vm.runTo(10);
    expect(garbageBitsOf(vm, [[0, 4]])).toBe(32);
    expect(garbageBitsOf(vm, [])).toBe(0);
  });
});

describe('forward and back track measurement', () => {
  it('measures both engines on the same program: same steps, the diary keeps 48 B per step, the reversible engine none', async () => {
    const { measureTracks } = await import('./track');
    const [diary, reversible] = await measureTracks(createWasmVm, ['logging', 'reversible'], loopImage(), { minTotalMs: 5 });
    expect(diary.steps).toBe(reversible.steps);
    expect(diary.steps).toBeGreaterThan(10);
    expect(diary.capped).toBe(false);
    expect(diary.historyBytes).toBe(diary.steps * 48);
    expect(reversible.historyBytes).toBe(0);
    expect(diary.restored && reversible.restored).toBe(true);
    expect(diary.endDigest).toBe(reversible.endDigest);
    expect(diary.forwardMs).toBeGreaterThanOrEqual(0);
    expect(diary.passes).toBeGreaterThanOrEqual(3);
  });

  it('formats times in the unit that keeps them short, and adds history and garbage into one total', async () => {
    const { formatMs } = await import('./track');
    expect([formatMs(0.0004), formatMs(0.038), formatMs(1.4), formatMs(12.34), formatMs(2100)]).toEqual(['< 1 µs', '38 µs', '1.40 ms', '12.3 ms', '2.10 s']);
    const { formatNs } = await import('./track');
    expect([formatNs(0.4), formatNs(8.25), formatNs(42.4), formatNs(1250)]).toEqual(['< 1 ns', '8.3 ns', '42 ns', '1.25 µs']);
    expect(totalBits(100, 64)).toBe(864); // history_bytes x 8 + garbage_bits (SPEC 12.1)
  });
});

describe('benchmark chart', () => {
  it('draws bench/results.json: five strategies at their measured memory, the naive diary labelled naive', async () => {
    const { pongPoints, benchChart, results } = await import('./panels/bench');
    const pts = pongPoints();
    expect(pts.map((p) => p.strategy)).toEqual(['naive', 'tight', 'checkpoint', 'checkpoint', 'checkpoint', 'reversible']);
    expect(pts[0].bytes).toBe(results.pong.naiveDiaryBytes);
    expect(pts[5].bytes).toBe(results.pong.reversibleGarbageBytes + results.pong.reversibleMachineHistoryBytes); // its input log; nothing in the machine
    expect(pts.every((p) => p.seekMean !== null)).toBe(true);
    const svg = benchChart(pts);
    const labels = [...svg.querySelectorAll('text.cmp-end')].map((e) => e.textContent);
    expect(labels).toHaveLength(6);
    expect(labels[0]).toMatch(/^Naive diary/);
    expect(labels.find((l) => l!.startsWith('Tight diary'))).toBeDefined();
    expect(labels.filter((l) => l!.startsWith('every')).length).toBe(3);
    expect(svg.querySelector('title, desc') === null).toBe(true);
    expect(svg.getAttribute('aria-label')).toContain('Naive diary');
  });
});
