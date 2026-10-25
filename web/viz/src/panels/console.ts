import { consoleText } from '../../../../lang/src/console';
import type { ReadMemory } from '../../../../lang/src/console';
import { h } from '../dom';
import type { Ctx, Panel } from './panel';

/**
 * The console, like the Output panel of an editor: what the program has printed, one line per row. It is read back from
 * the machine's memory at the current time, so stepping back un-prints. A program that never prints shows nothing here.
 * New lines scroll into view unless Lock scroll is on.
 */
export function consolePanel(): Panel & { used(): boolean } {
  const el = h('section', 'console');
  el.setAttribute('aria-label', 'console');
  const head = h('header', 'console-head');
  const lock = h('button', 'btn small console-lock', 'Lock scroll');
  lock.type = 'button';
  lock.setAttribute('aria-pressed', 'false');
  lock.title = 'Keep the view where it is while new lines arrive';
  head.append(h('h2', 'console-title', 'Console'), h('span', 'dim', 'rewinds with time'), h('span', 'grow'), lock);
  const body = h('div', 'console-body mono');
  body.tabIndex = 0;
  body.setAttribute('role', 'log');
  body.setAttribute('aria-label', 'console output');
  el.append(head, body);

  let locked = false;
  let program: object | null | undefined;
  let everPrinted = false;
  let shown = '';
  lock.addEventListener('click', () => {
    locked = !locked;
    lock.setAttribute('aria-pressed', String(locked));
  });

  return {
    el,
    used: () => everPrinted,
    update({ vm, program: p }: Ctx) {
      if (p !== program) {
        program = p;
        everPrinted = false;
        shown = '';
        body.replaceChildren();
      }
      const read: ReadMemory = (a, n) => vm.memory(a, n);
      const text = consoleText(read);
      if (text !== '') everPrinted = true;
      el.hidden = !everPrinted;
      if (text === shown) return;
      shown = text;
      const lines = text === '' ? [] : text.split('\n');
      body.replaceChildren(...lines.map((l) => h('div', 'console-line', l === '' ? ' ' : l)));
      if (!locked) body.scrollTop = body.scrollHeight;
    },
  };
}
