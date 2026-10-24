import { FB_HEIGHT, FB_WIDTH } from '../../../../spec/vm_api';
import { h } from '../dom';
import { describeKey } from '../keys';
import { framebufferPanel } from './framebuffer';
import type { Ctx, Panel } from './panel';

/** Largest whole-number scale at which a 64x32 screen fits in the given box (at least 1). */
export function integerScale(width: number, height: number): number {
  return Math.max(1, Math.floor(Math.min(width / FB_WIDTH, height / FB_HEIGHT)));
}

/** The Screen tab: the framebuffer at an integer scale plus the "keys go to the machine" switch. */
export function screenPanel(): Panel & { capturing(): boolean; setLastKey(value: number): void } {
  const fb = framebufferPanel();
  const el = h('div', 'screen');
  const bar = h('label', 'capture');
  const box = h('input');
  box.type = 'checkbox';
  box.checked = true;
  const last = h('span', 'last-key mono', '');
  bar.append(box, h('span', '', 'Send keys to the machine'), last);
  el.append(fb.el, bar);

  const fit = (): void => {
    // the width sets the scale: a whole number of screen pixels per machine pixel, at most 10
    const w = el.clientWidth - 2 * 12 - 2;
    if (w > 0) fb.setScale(Math.min(10, integerScale(w, Number.MAX_SAFE_INTEGER)));
  };
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fit).observe(el);

  return {
    el,
    update: (ctx: Ctx) => fb.update(ctx),
    capturing: () => box.checked,
    setLastKey: (value) => {
      last.textContent = describeKey(value);
    },
  };
}
