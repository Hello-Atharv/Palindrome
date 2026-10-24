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
  const last = h('span', 'last-key mono', 'no key yet');
  bar.append(box, h('span', '', 'send keys to the machine while this tab is open'), last);
  el.append(fb.el, bar);

  const fit = (): void => {
    // room for the frame padding (10px), the gap (8px) and the capture bar (24px)
    const w = el.clientWidth - 10;
    const hgt = el.clientHeight - 10 - 8 - 24;
    if (w > 0 && hgt > 0) fb.setScale(integerScale(w, hgt));
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
