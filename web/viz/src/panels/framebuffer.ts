import { FB_HEIGHT, FB_WIDTH } from '../../../../spec/vm_api';
import { h } from '../dom';
import type { Ctx, Panel } from './panel';

/**
 * The 64x32 framebuffer on a canvas. Pixels are 0x00RRGGBB words; the canvas wants ABGR bytes in memory order.
 * Drawn at an integer scale with no smoothing so pixels stay crisp; `setScale` is called by the Screen tab.
 */
export function framebufferPanel(): Panel & { setScale(n: number): void } {
  const el = h('div', 'screen-frame');
  const canvas = h('canvas', 'fb');
  canvas.width = FB_WIDTH;
  canvas.height = FB_HEIGHT;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'machine framebuffer, 64 by 32 pixels');
  el.append(canvas);
  const ctx2d = canvas.getContext('2d');
  const image = ctx2d ? ctx2d.createImageData(FB_WIDTH, FB_HEIGHT) : null;
  const out = image ? new Uint32Array(image.data.buffer) : null;

  const setScale = (n: number): void => {
    canvas.style.width = `${FB_WIDTH * n}px`;
    canvas.style.height = `${FB_HEIGHT * n}px`;
  };
  setScale(8);

  return {
    el,
    setScale,
    update({ snap }: Ctx) {
      if (!ctx2d || !image || !out) return;
      const fb = snap.fb;
      for (let i = 0; i < out.length; i++) {
        const p = fb[i];
        out[i] = 0xff000000 | ((p & 0xff) << 16) | (p & 0xff00) | ((p >>> 16) & 0xff);
      }
      ctx2d.putImageData(image, 0, 0);
    },
  };
}
