// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { assemble } from '../../../asm/src/index';
import { compile } from '../../../lang/src/compile';
import pongSource from '../../../examples/demos/pong.s?raw';
import { createWasmVm } from '../../wasm/src/index';
import type { AssembleFn } from './assembler';
import { attachKeys } from './keys';
import type { ProgramEntry } from './program';
import { mountViz } from './shell';
import type { VizHandle } from './shell';

const assembleHook: AssembleFn = (source, fileName) => {
  const r = assemble(source, { fileName });
  return { ok: r.ok, image: r.image, diagnostics: r.diagnostics, listing: r.listing };
};
const pong: ProgramEntry = {
  name: 'pong',
  source: pongSource,
  load: () => assemble(pongSource).image!,
  game: { note: 'play', blocks: true, log: { addr: 0x1000, bytesPerFrame: 8 } },
};

async function mount(kind: 'logging' | 'reversible'): Promise<{ root: HTMLElement; viz: VizHandle }> {
  HTMLCanvasElement.prototype.getContext = () => null;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.hasPointerCapture = () => true;
  Element.prototype.releasePointerCapture = () => {};
  localStorage.clear();
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app')!;
  const viz = mountViz(root, await createWasmVm(kind), { programs: [pong], createVm: createWasmVm, engines: ['logging', 'reversible'], assemble: assembleHook });
  return { root, viz };
}
const state = (viz: VizHandle) => JSON.stringify([Array.from(viz.vm.registers().regs), viz.vm.registers().pc, Array.from(viz.vm.framebuffer())]);

describe('Pong in the shell', () => {
  for (const kind of ['logging', 'reversible'] as const) {
    it(`steps frame by frame on the ${kind} engine, shows the frame number, and Back one frame is exact`, async () => {
      const { root, viz } = await mount(kind);
      expect(viz.program?.game).toBeDefined();
      expect(root.querySelector<HTMLElement>('.frame-btn')!.hidden).toBe(false);
      const label = () => root.querySelector('.debugbar .tbar-t')!.textContent;
      expect(label()).toBe('frame0');

      const atStart = state(viz);
      viz.stepFrame();
      const t1 = viz.vm.instructionCount;
      expect(t1).toBeGreaterThan(50); // a frame is many instructions
      expect(label()).toBe('frame1');
      const afterOne = state(viz);
      viz.pushInput(0x57); // W: a key press goes in the input log
      viz.stepFrame();
      viz.stepFrame();
      expect(label()).toBe('frame3');
      expect(root.querySelector('.game')!.textContent).toContain('Frame3');

      viz.backFrame();
      expect(label()).toBe('frame2');
      viz.backFrame();
      expect(label()).toBe('frame1');
      expect(state(viz)).toBe(afterOne); // exactly the state we saw going forward, key press and all
      viz.backFrame();
      expect(viz.vm.instructionCount).toBe(0);
      expect(state(viz)).toBe(atStart);
    });
  }

  it('a key pressed after going back starts a new timeline: the frames after it are forgotten', async () => {
    const { viz } = await mount('reversible');
    viz.stepFrame(); viz.stepFrame(); viz.stepFrame();
    viz.backFrame(); viz.backFrame();
    viz.pushInput(0x53);
    expect(viz.branch).toBe(true);
    viz.stepFrame();
    expect(viz.vm.instructionCount).toBeGreaterThan(0);
    viz.stepFrame();
    viz.backFrame();
    viz.backFrame();
    viz.backFrame();
    expect(viz.vm.instructionCount).toBeLessThan(viz.maxT);
  });

  it('the direction warning is in the toggle and in the banner', async () => {
    const { root, viz } = await mount('logging');
    expect(root.querySelector<HTMLElement>('.dir-toggle')!.title).toContain('Pong');
    viz.setDirection(-1);
    expect(root.querySelector('.banner.reverse')!.textContent).toContain('use Back');
    expect(root.querySelector('.dir-toggle')).not.toBeNull(); // the toggle is not hidden
  });
});

describe('keys', () => {
  it('prevents the default of every handled key, auto-repeats included, but sends only the first press', () => {
    const sent: number[] = [];
    const detach = attachKeys((v) => sent.push(v), () => true);
    const key = (repeat: boolean, k = 'ArrowDown') => {
      const ev = new KeyboardEvent('keydown', { key: k, repeat, cancelable: true, bubbles: true });
      window.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    expect(key(false)).toBe(true);
    expect(key(true)).toBe(true); // a held arrow key must not scroll the page
    expect(key(true)).toBe(true);
    expect(sent).toEqual([0x81]); // only the first press is an input event
    expect(key(false, 'F5')).toBe(false); // an unhandled key keeps its default
    detach();
  });

  it('the dropdowns give up focus after a change, so the arrows reach the game', async () => {
    const { root } = await mount('logging');
    const select = root.querySelector<HTMLSelectElement>('.viz-header .program-select')!;
    select.focus();
    expect(document.activeElement).toBe(select);
    select.dispatchEvent(new Event('change'));
    expect(document.activeElement).not.toBe(select);
  });
});

describe('the .s / .rev switch', () => {
  it('appears for a program that exists in both languages, loads the other one, and keeps the picker on the same entry', async () => {
    HTMLCanvasElement.prototype.getContext = () => null;
    Element.prototype.setPointerCapture = () => {};
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const revSource = 'main { }\n';
    const asmEntry: ProgramEntry = { name: 'tiny', source: 'start: hlt\n', load: () => assemble('start: hlt\n').image! };
    const revEntry: ProgramEntry = { name: 'tiny (rev)', source: revSource, language: 'rev', load: () => compile(revSource).image! };
    asmEntry.alt = revEntry;
    revEntry.alt = asmEntry;
    const plain: ProgramEntry = { name: 'plain', source: 'start: hlt\n', load: () => assemble('start: hlt\n').image! };
    const compileHook: AssembleFn = (source) => {
      const c = compile(source);
      return { ok: c.ok, image: c.image, diagnostics: [], listing: [] };
    };
    const viz = mountViz(root, await createWasmVm('logging'), { programs: [asmEntry, plain], createVm: createWasmVm, engines: ['logging', 'reversible'], assemble: assembleHook, compile: compileHook });
    const sw = root.querySelector<HTMLElement>('.variant')!;
    const pressed = () => [...sw.querySelectorAll('button')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent);
    expect(sw.classList.contains('off')).toBe(false);
    expect(root.querySelector('.editor .ed-tab')!.contains(sw)).toBe(true); // in the editor header, level with the file name
    expect(pressed()).toEqual(['.s']);
    expect(viz.program?.language).toBeUndefined();

    sw.querySelectorAll('button')[1].click(); // .rev
    expect(viz.program?.name).toBe('tiny (rev)');
    expect(viz.program?.language).toBe('rev');
    expect(pressed()).toEqual(['.rev']);
    expect(root.querySelector('.ed-file')!.textContent).toBe('tiny.rev');
    expect(root.querySelector<HTMLSelectElement>('.viz-header .program-select')!.value).toBe('0'); // still the same entry in the picker

    sw.querySelectorAll('button')[0].click(); // back to .s
    expect(viz.program?.name).toBe('tiny');
    expect(pressed()).toEqual(['.s']);

    root.querySelector<HTMLSelectElement>('.viz-header .program-select')!.value = '1'; // a program with no twin
    root.querySelector<HTMLSelectElement>('.viz-header .program-select')!.dispatchEvent(new Event('change'));
    expect(sw.classList.contains('off')).toBe(true); // invisible, but it keeps its place
    expect(root.querySelector('.editor .ed-tab')!.contains(sw)).toBe(true);
  });
});

describe('a custom speed', () => {
  it('can be typed in thousands of steps per second, drives the run speed and the time bar scale, and is dropped when a listed speed is chosen', async () => {
    const { root, viz } = await mount('logging');
    const select = root.querySelector<HTMLSelectElement>('.debugbar .transport select')!;
    const field = root.querySelector<HTMLInputElement>('.debugbar .speed-custom-field')!;
    expect(field.closest('.speed-custom')!.hasAttribute('hidden')).toBe(true);
    expect([...select.options].map((o) => o.textContent).pop()).toBe('custom…');

    select.value = 'custom';
    select.dispatchEvent(new Event('change'));
    expect(field.closest('.speed-custom')!.hasAttribute('hidden')).toBe(false);
    field.value = '2.5'; // 2.5 k/s = 2,500 steps per second
    field.dispatchEvent(new Event('change'));
    expect(root.querySelector('.debugbar .tbar-label')!.textContent).toContain('full at 12,500 instructions'); // 5 seconds of it
    expect(select.value).toBe('custom');
    expect(root.querySelector<HTMLInputElement>('.cmp-top .speed-custom-field')!.value).toBe('2.5'); // the Compare controls follow

    field.value = '-3'; // nonsense is ignored
    field.dispatchEvent(new Event('change'));
    expect(root.querySelector('.debugbar .tbar-label')!.textContent).toContain('12,500');

    select.value = '0'; // a listed speed (1/s)
    select.dispatchEvent(new Event('change'));
    expect(field.closest('.speed-custom')!.hasAttribute('hidden')).toBe(true);
    expect(root.querySelector('.debugbar .tbar-label')!.textContent).toContain('full at 5 instructions');
    expect(viz.vm.kind).toBe('logging');
  });
});
