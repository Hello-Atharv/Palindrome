// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { consoleText } from '../../../lang/src/console';
import { compile } from '../../../lang/src/compile';
import hello from '../../../examples/rev/hello.rev?raw';
import pongRev from '../../../examples/demos/pong.rev?raw';
import { createWasmVm } from '../../wasm/src/index';
import type { AssembleFn } from './assembler';
import type { ProgramEntry } from './program';
import { mountViz } from './shell';
import { tokenizeRevLine } from './highlight';

const compileHook: AssembleFn = (source) => {
  const c = compile(source);
  const lines = source.split('\n');
  const listing = (c.ok && c.assembled && c.lineMap ? c.assembled.listing : []).map((r) => {
    const line = c.lineMap![r.line - 1] ?? 0;
    return { addr: r.addr, word: r.word, line, text: lines[line - 1] ?? '' };
  });
  return { ok: c.ok, image: c.image, diagnostics: c.diagnostics.map((d) => ({ severity: 'error' as const, line: d.line, message: d.message })), listing };
};
const rev = (name: string, source: string, game?: ProgramEntry['game']): ProgramEntry => ({ name, source, language: 'rev', game, load: () => compile(source).image! });

async function mount(programs: ProgramEntry[]) {
  HTMLCanvasElement.prototype.getContext = () => null;
  Element.prototype.setPointerCapture = () => {};
  localStorage.clear();
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app')!;
  const viz = mountViz(root, await createWasmVm('reversible'), {
    programs, createVm: createWasmVm, engines: ['logging', 'reversible'], compile: compileHook, report: async () => 'a report',
  });
  return { root, viz };
}

describe('rev programs in the shell', () => {
  it('shows rev source with rev colours, maps the current line to the rev source, and prints to the console that rewinds', async () => {
    const { root, viz } = await mount([rev('hello (rev)', hello)]);
    expect(viz.program?.language).toBe('rev');
    expect(root.querySelector('.ed-file')!.textContent).toBe('hello (rev).rev');
    expect(root.querySelector('.ed-syn .tok-comment')).not.toBeNull();
    expect(root.querySelector('.ed-syn .tok-directive')!.textContent).toBe('var');
    expect(viz.program!.listing!.length).toBeGreaterThan(10);
    expect(root.querySelector('.ed-cur')).not.toBeNull();

    let n = 0;
    while (viz.step() === 'ok') n++;
    expect(consoleText((a, c) => viz.vm.memory(a, c))).toContain('fib(10) = 55');
    root.querySelectorAll<HTMLButtonElement>('.work > .tabs .tab')[1].click();
    expect(root.querySelector<HTMLElement>('.out .console')!.hidden).toBe(false);
    for (let i = 0; i < n; i++) viz.stepBack();
    expect(consoleText((a, c) => viz.vm.memory(a, c))).toBe(''); // un-printed
  });

  it('Pong in rev is a game: frame stepping works, and the cost report button is there for rev programs only', async () => {
    const { root, viz } = await mount([rev('pong (rev)', pongRev, { note: 'play' }), { name: 'plain', source: 'start: hlt\n', load: () => compile('main { }').image! }]);
    expect(root.querySelector<HTMLElement>('.report')!.hidden).toBe(false);
    viz.stepFrame();
    viz.stepFrame();
    expect(root.querySelector('.debugbar .tbar-t')!.textContent).toBe('frame2');
    viz.backFrame();
    expect(root.querySelector('.debugbar .tbar-t')!.textContent).toBe('frame1');
  });

  it('tokenizes rev', () => {
    expect(tokenizeRevLine('  call step; // go').map((t) => `${t.kind}:${t.text.trim()}`)).toEqual(['plain:', 'op:call', 'plain:step;', 'comment:// go']);
  });
});
