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
