import { FB_HEIGHT, FB_WIDTH } from '../../../../spec/vm_api';
import { h } from '../dom';
import { describeKey } from '../keys';
import { framebufferPanel } from './framebuffer';
import type { Ctx, Panel } from './panel';

/** Largest whole-number scale at which a 64x32 screen fits in the given box (at least 1). */
export function integerScale(width: number, height: number): number {
  return Math.max(1, Math.floor(Math.min(width / FB_WIDTH, height / FB_HEIGHT)));
}

/**
 * The screen (the framebuffer at an integer scale) and, separately, the "keys go to the machine" switch with the last key
 * pressed. The switch lives with the other input controls, not under the picture.
 */
export function screenPanel(): Panel & { keys: HTMLElement; capturing(): boolean; setLastKey(value: number): void } {
  const fb = framebufferPanel();
  const el = h('div', 'screen');
  el.append(fb.el);

  const keys = h('label', 'capture');
  const box = h('input');
  box.type = 'checkbox';
  box.checked = true;
  const last = h('span', 'last-key mono', '');
  keys.append(box, h('span', '', 'Send keys to the machine'), last);

  const fit = (): void => {
    // the width sets the scale: a whole number of screen pixels per machine pixel, at most 6
    const w = el.clientWidth - 2;
    if (w > 0) fb.setScale(Math.min(6, integerScale(w, Number.MAX_SAFE_INTEGER)));
  };
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fit).observe(el);

  return {
    el,
    keys,
    update: (ctx: Ctx) => fb.update(ctx),
    capturing: () => box.checked,
    setLastKey: (value) => {
      last.textContent = value ? `Last key: ${describeKey(value)}` : '';
    },
  };
}
