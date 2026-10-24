import { h } from '../dom';
import { describeKey } from '../keys';
import { framebufferPanel } from './framebuffer';
import type { Ctx, Panel } from './panel';

/** The Screen tab: the framebuffer plus the "keys go to the machine" switch. */
export function screenPanel(): Panel & { capturing(): boolean; setLastKey(value: number): void } {
  const fb = framebufferPanel();
  const el = h('div', 'screen');
  const bar = h('label', 'capture');
  const box = h('input');
  box.type = 'checkbox';
  box.checked = true;
  const last = h('span', 'last-key mono', 'no key yet');
  bar.append(box, h('span', '', 'send keys to the machine while this tab is open'), last);
  el.append(fb.el, bar);
  return {
    el,
    update: (ctx: Ctx) => fb.update(ctx),
    capturing: () => box.checked,
    setLastKey: (value) => {
      last.textContent = describeKey(value);
    },
  };
}
