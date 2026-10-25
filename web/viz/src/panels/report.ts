import { h } from '../dom';
import type { Ctx, Panel } from './panel';

/**
 * The cost report for a rev program (lang/src/report.ts): steps for every source line, what the program kept (garbage), what
 * the two engines hold to be able to go back, and a round-trip check. It runs the program on fresh engines, so it is computed
 * on request. Hidden for every other program.
 */
export function reportPanel(run: (source: string, name: string) => Promise<string>, enabled: boolean): Panel {
  const el = h('section', 'report');
  el.setAttribute('aria-label', 'cost report');
  const head = h('div', 'report-head');
  const button = h('button', 'btn small', 'Cost report');
  button.type = 'button';
  button.title = 'Run this rev program on fresh engines and report what every line costs and what the program had to keep';
  head.append(h('h2', 'report-title', 'What it costs'), h('span', 'dim', 'steps per line, garbage, history'), h('span', 'grow'), button);
  const out = h('pre', 'report-text mono');
  out.hidden = true;
  el.append(head, out);

  let program: object | null | undefined;
  let source = '';
  let name = '';
  let busy = false;
  button.addEventListener('click', async () => {
    if (busy || !source) return;
    busy = true;
    button.disabled = true;
    out.hidden = false;
    out.textContent = 'Running the program on both engines…';
    try {
      out.textContent = await run(source, name);
    } catch (e) {
      out.textContent = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
      button.disabled = false;
    }
  });

  return {
    el,
    update({ program: p }: Ctx) {
      el.hidden = !enabled || p?.language !== 'rev' || !p.source;
      if (p === program) return;
      program = p;
      source = p?.source ?? '';
      name = p?.name ?? '';
      out.hidden = true;
      out.textContent = '';
    },
  };
}
