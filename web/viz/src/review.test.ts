// @vitest-environment jsdom
// The fixes from the interface review: reduced motion, the keyboard-resizable divider, names and labels, and the live region.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assemble } from '../../../asm/src/index';
import { compile } from '../../../lang/src/compile';
import hello from '../../../examples/rev/hello.rev?raw';
import { createWasmVm } from '../../wasm/src/index';
import type { AssembleFn } from './assembler';
import type { ProgramEntry } from './program';
import { mountViz } from './shell';
import type { VizHandle } from './shell';

const assembleHook: AssembleFn = (source, fileName) => {
  const r = assemble(source, { fileName });
  return { ok: r.ok, image: r.image, diagnostics: r.diagnostics, listing: r.listing };
};
const compileHook: AssembleFn = (source) => {
  const c = compile(source);
  return { ok: c.ok, image: c.image, diagnostics: [], listing: [] };
};
const SMALL = 'start: addi r1, 5\n addi r2, 7\n hlt\n';
const small: ProgramEntry = { name: 'small', source: SMALL, load: () => assemble(SMALL).image! };
const revHello: ProgramEntry = { name: 'hello (rev)', source: hello, language: 'rev', load: () => compile(hello).image! };

async function mount(programs: ProgramEntry[]): Promise<{ root: HTMLElement; viz: VizHandle }> {
  HTMLCanvasElement.prototype.getContext = () => null;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.hasPointerCapture = () => true;
  Element.prototype.releasePointerCapture = () => {};
  localStorage.clear();
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app')!;
  const viz = mountViz(root, await createWasmVm('logging'), { programs, createVm: createWasmVm, engines: ['logging', 'reversible'], assemble: assembleHook, compile: compileHook });
  return { root, viz };
}
afterEach(() => vi.unstubAllGlobals());

describe('reduced motion', () => {
  const sphereVisible = (root: HTMLElement) => root.querySelector('.dp-sphere')!.getAttribute('visibility');

  it('plays the travelling sphere by default', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const { root, viz } = await mount([small]);
    viz.step();
    expect(sphereVisible(root)).toBe('visible');
  });

  it('shows the new state at once, with no sphere, when the user prefers reduced motion', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('prefers-reduced-motion') }));
    const { root, viz } = await mount([small]);
    viz.step();
    expect(sphereVisible(root)).toBe('hidden');
    expect(viz.vm.registers().regs[1]).toBe(5); // the step still happened
    expect(root.querySelector('.vis-note')!.textContent).toContain('Next:'); // and the note says what comes next
  });
});

describe('the editor divider by keyboard', () => {
  it('is a focusable separator that the arrow keys resize and Home resets, within the limits', async () => {
    const { root } = await mount([small]);
    Object.defineProperty(root.querySelector('.split')!, 'clientWidth', { value: 1200 });
    const divider = root.querySelector<HTMLElement>('.divider')!;
    expect(divider.tabIndex).toBe(0);
    expect(divider.getAttribute('role')).toBe('separator');
    const key = (k: string, shiftKey = false) => divider.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true, cancelable: true }));
    key('ArrowRight'); // from the 380px fallback
    expect(root.style.getPropertyValue('--ide-w')).toBe('404px');
    expect(divider.getAttribute('aria-valuenow')).toBe('404');
    key('ArrowLeft', true); // Shift: 96px
    expect(root.style.getPropertyValue('--ide-w')).toBe('308px');
    for (let i = 0; i < 20; i++) key('ArrowLeft', true);
    expect(root.style.getPropertyValue('--ide-w')).toBe('260px'); // never narrower than 260px
    key('Home');
    expect(root.style.getPropertyValue('--ide-w')).toBe('');
    expect(key('a')).toBe(true); // other keys are left alone
  });

  it('does nothing while the editor is collapsed, and the collapse button keeps its own keys', async () => {
    const { root } = await mount([small]);
    root.querySelector<HTMLButtonElement>('.divider-btn')!.click();
    const divider = root.querySelector<HTMLElement>('.divider')!;
    divider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    expect(root.style.getPropertyValue('--ide-w')).toBe('');
  });
});

describe('names, labels and the live region', () => {
  it('the editor file name carries all of its text in a title, and the source is labelled for its language', async () => {
    const { root } = await mount([revHello, small]);
    expect(root.querySelector<HTMLElement>('.ed-file')!.title).toBe('hello.rev');
    expect(root.querySelector('.ed-text')!.getAttribute('aria-label')).toBe('rev source');
    root.querySelector<HTMLSelectElement>('.viz-header .program-select')!.value = '1';
    root.querySelector<HTMLSelectElement>('.viz-header .program-select')!.dispatchEvent(new Event('change'));
    expect(root.querySelector<HTMLElement>('.ed-file')!.title).toBe('small.s');
    expect(root.querySelector('.ed-text')!.getAttribute('aria-label')).toBe('assembly source');
  });

  it('the run-time slider says "frame N, t M" for a game and "t M" otherwise', async () => {
    const { root, viz } = await mount([small]);
    viz.step();
    expect(root.querySelector('.debugbar .tbar-track')!.getAttribute('aria-valuetext')).toBe('t 1');
    expect(root.querySelector('.debugbar .tbar-track')!.getAttribute('aria-valuenow')).toBe('1');
  });

  it('the animation note is not a live region: a separate status region carries the settled state only', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const { root, viz } = await mount([small]);
    expect(root.querySelector('.vis-note')!.hasAttribute('role')).toBe(false);
    const live = root.querySelector('.vis .sr-only[role="status"]')!;
    expect(live.textContent).toContain('Next:');
    viz.step(); // the animation starts: the note changes at every phase, the live region does not
    const before = live.textContent;
    expect(root.querySelector('.vis-note')!.textContent).not.toBe('');
    expect(live.textContent).toBe(before);
  });

  it('no tooltip tells the user about a source folder', async () => {
    const { root } = await mount([small]);
    const titles = [...root.querySelectorAll('[title]')].map((e) => e.getAttribute('title')!);
    expect(titles.filter((t) => /web\/wasm/.test(t))).toEqual([]);
  });
});

describe('the time-travel controls', () => {
  it('Back and Step carry a visible word that is part of their accessible name, and the header says what the tool does', async () => {
    const { root } = await mount([small]);
    const back = root.querySelector<HTMLElement>('.debugbar .step-back')!;
    const step = root.querySelector<HTMLElement>('.debugbar .step-fwd')!;
    expect(back.querySelector('.ibtn-label')!.textContent).toBe('Back');
    expect(step.querySelector('.ibtn-label')!.textContent).toBe('Step');
    expect(back.getAttribute('aria-label')!.toLowerCase()).toContain('back'); // WCAG 2.5.3: the visible word is in the name
    expect(step.getAttribute('aria-label')!.toLowerCase()).toContain('step');
    expect(root.querySelector('.viz-header .tagline')!.textContent).toContain('every instruction can be undone');
  });
});

describe('the Benchmarks tab in the Compare environment', () => {
  it('is the second of two tabs at the top of Compare, with no run controls, its own Pong | Sort switch, and plain explanations', async () => {
    const { root } = await mount([small]);
    const tabs = [...root.querySelectorAll<HTMLButtonElement>('.cmp-tabs .tab')];
    expect(tabs.map((t) => t.textContent)).toEqual(['Compare', 'Benchmarks']);
    const live = root.querySelector<HTMLElement>('.cmp-live')!;
    const bench = root.querySelector<HTMLElement>('.cmp-bench')!;
    expect(live.hidden).toBe(false);
    expect(bench.hidden).toBe(true);
    expect(live.querySelector('.cmp-top')).not.toBeNull(); // the run controls live in the Compare tab only
    expect(bench.querySelector('.cmp-top')).toBeNull();
    expect(bench.querySelector('.cmp-card')).toBeNull();

    tabs[1].click();
    expect(live.hidden).toBe(true);
    expect(bench.hidden).toBe(false);
    expect(bench.querySelector('.bench-lead')!.textContent).toMatch(/^Over 200 frames of Pong, the reversible program keeps/);
    expect(bench.querySelectorAll('.cmp-chart-svg').length).toBe(1);
    const buttons = [...bench.querySelectorAll<HTMLButtonElement>('.segmented .seg')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Pong', 'Sort']);
    buttons[1].click();
    expect(bench.querySelector('.bench-lead')!.textContent).toMatch(/^Sorting 8 numbers/);
    expect(bench.querySelectorAll('.cmp-chart-svg').length).toBe(0); // no chart: seeking was not measured for sort
    expect(bench.textContent).toContain('not measured');

    const words = bench.textContent!;
    expect(words).toContain('Naive diary');
    expect(words).toContain('Reversible costs time');
    expect(words).not.toMatch(/bench\/|TWINS\.md|web\/|serious competitor|seamless/i); // no source paths, no filler (avoid-ai-design-ignore: CP2, the test checks that the word is absent)
    tabs[0].click();
    expect(live.hidden).toBe(false);
  });
});

describe('the offline baselines in the Compare table', () => {
  it('are the numbers in bench/results.json, exactly: per frame for Pong, for the whole run for sort, nothing for anything else', async () => {
    const { offlineBaselines } = await import('./panels/bench');
    const pong = offlineBaselines('pong')!;
    expect(pong.tight).toEqual(['125.76 B a frame', '–', '201,216 bits over 200 frames', '122.515 steps a frame', '1 step']);
    expect(pong.checkpoint).toEqual(['14.94 to 1,225.08 B a frame', '–', '23,904 bits to 1,960,128 bits over 200 frames', '122.515 steps a frame', 'worst case 99 to 9,984 steps of replay']);
    expect(pong.naiveVsTight).toBe('The live diary here is the naive one: 48 B a step, which is 19,144.56 B a frame for Pong. The tight diary needs 125.76 B a frame for the same program (25,152 B over 200 frames).');
    expect(offlineBaselines('pong (rev)')!.tight).toEqual(pong.tight); // either language is the same program
    const sort = offlineBaselines('sort')!;
    expect(sort.tight[0]).toBe('269 B for the whole run');
    expect(sort.checkpoint).toBeNull(); // not measured for sort
    expect(sort.naiveVsTight).toContain('269 B for the same program, against 14,928 B for the naive diary');
    expect(offlineBaselines('loop')).toBeNull();
  });
});

describe('the Virtual Machine History Over Time section', () => {
  const entry = (name: string): ProgramEntry => ({ name, source: SMALL, load: () => assemble(SMALL).image! });
  async function measure(name: string) {
    const { root, viz } = await mount([entry(name)]);
    root.querySelector<HTMLButtonElement>('.compare-btn')!.click();
    await vi.waitFor(() => expect(viz.machines.length).toBe(2), { timeout: 10000 });
    root.querySelector<HTMLButtonElement>('.cmp-live .btn.primary')!.click();
    await vi.waitFor(() => expect(root.querySelectorAll('.cmp-verdict li').length).toBeGreaterThan(2), { timeout: 30000 });
    return root;
  }
  const lines = (root: HTMLElement) => [...root.querySelectorAll('.cmp-verdict li')].map((l) => l.textContent);
  const rows = (root: HTMLElement) => [...root.querySelectorAll('.cmp-live .cmp-table [role="row"]')].map((r) => [...r.children].map((c) => c.textContent));

  it('reads in the order: heading, how it runs, what it shows, the chart, the table, the summary', async () => {
    const { root } = await mount([small]);
    const box = root.querySelector('.cmp-live .cmp-section')!;
    expect([...box.children].map((c) => c.className.split(' ')[0])).toEqual(['cmp-head', 'dim', 'dim', 'cmp-chart', 'cmp-table', 'dim', 'cmp-verdict']);
    expect(box.querySelector('h2')!.textContent).toBe('Virtual Machine History Over Time');
    expect(box.children[1].textContent).toBe('Each engine runs the program forward until it halts (or for 100,000 steps), then backwards in time to the start.');
    expect(box.children[2].textContent).toContain('Rewinding costs the reversible engine no history. That does not necessarily make the reversible programs cheaper overall');
    expect(box.textContent).not.toContain('This repeats until the timings settle');
  });

  it('summarises a measurement as short lines, and for an ordinary program says the tight diary was measured offline for Pong and sort only', async () => {
    const root = await measure('loop');
    const l = lines(root);
    expect(l).toHaveLength(6);
    expect(l[0]).toMatch(/^\d+ steps, averaged over [\d,]+ passes\.$/);
    expect(l[1]).toMatch(/^To go back, the diary keeps .+ and the reversible engine keeps 0 B\.$/);
    expect(l[2]).toMatch(/^Going back, per step: reversible .+, diary .+ \(too short to time reliably\)\.$/); // a run of a few steps cannot be timed
    expect(l[3]).toMatch(/^Going back, whole run: reversible [\d.]+ ?(ns|µs|ms), diary [\d.]+ ?(ns|µs|ms)\.$/); // under a microsecond is shown in nanoseconds
    expect(l[4]).toBe('Both engines returned to exactly the starting state.');
    expect(l[5]).toBe('The live diary here is the naive one: 48 B a step. A tight diary was measured offline for Pong and sort only: see Benchmarks.');
    const r = rows(root);
    expect(r.map((x) => x[0])).toEqual(['Strategy', 'Naive diary', 'Reversible', 'Tight diary', 'Checkpoint and replay']);
    expect(r[3][1]).toBe('measured offline on the conventional program, for Pong and sort only: see Benchmarks');
    expect(root.querySelector('.cmp-table-note')!.textContent).toContain('measured offline on the conventional program, not in this live run');
  });

  it('fills the tight diary and checkpoint rows for Pong from the benchmark, and names the tight diary next to the naive one', async () => {
    const root = await measure('pong');
    const r = rows(root);
    expect(r[3]).toEqual(['Tight diary', '125.76 B a frame', '–', '201,216 bits over 200 frames', '122.515 steps a frame', '1 step']);
    expect(r[4][1]).toBe('14.94 to 1,225.08 B a frame');
    expect(lines(root).pop()).toContain('The tight diary needs 125.76 B a frame for the same program (25,152 B over 200 frames).');
    expect(root.querySelector('.cmp-table-note')!.textContent).toContain('200 frames of Pong with 105 key presses');
  });

  it('fills the tight diary row for sort, and says checkpointing was not measured for it', async () => {
    const root = await measure('sort');
    const r = rows(root);
    expect(r[3][1]).toBe('269 B for the whole run');
    expect(r[4][1]).toBe('not measured for sort: see Benchmarks');
  });

  it('the tables are real tables to assistive technology, and the summary is announced', async () => {
    const root = await measure('loop');
    const table = root.querySelector<HTMLElement>('.cmp-live .cmp-table')!;
    expect(table.getAttribute('role')).toBe('table');
    expect(table.querySelectorAll('[role="columnheader"]').length).toBe(6);
    expect(table.querySelectorAll('[role="rowheader"]').length).toBe(4);
    expect(root.querySelector('.cmp-verdict')!.getAttribute('aria-live')).toBe('polite');
  });
});

describe('the Benchmarks tab text', () => {
  it('has title-case section headings, the four strategies defined, and no "undo" or filler', async () => {
    const { root } = await mount([small]);
    const bench = root.querySelector<HTMLElement>('.cmp-bench')!;
    expect([...bench.querySelectorAll('h2, h3')].map((e) => e.textContent)).toEqual(['Benchmarks', 'How to Read This', 'What This Does Not Show']);
    expect([...bench.querySelectorAll('.bench-guide dt')].map((e) => e.textContent)).toEqual(['Naive diary', 'Tight diary', 'Checkpoint and replay', 'Reversible', 'Memory held', 'Back one step', 'Seek']);
    expect(bench.textContent).toContain('the same program written for an ordinary machine that overwrites values');
    expect(bench.textContent).toContain('In this measurement');
    expect(bench.textContent).not.toMatch(/\bundo\b|inverse step/i);
    expect(bench.querySelector('.cmp-table')!.getAttribute('role')).toBe('table');
  });
});
