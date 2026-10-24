import { FB_HEIGHT, FB_WIDTH } from '../../../../spec/vm_api';
import { h } from '../dom';
import { frame } from './panel';
import type { Ctx, Panel } from './panel';

/** The 64x32 framebuffer on a canvas. Pixels are 0x00RRGGBB words; the canvas wants ABGR bytes in memory order. */
export function framebufferPanel(): Panel {
  const { el, body, head } = frame('Display', 'display');
  const canvas = h('canvas', 'fb');
  canvas.width = FB_WIDTH;
  canvas.height = FB_HEIGHT;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'machine framebuffer, 64 by 32 pixels');
  const ctx2d = canvas.getContext('2d');
  head.append(h('span', 'badge mono', `${FB_WIDTH}×${FB_HEIGHT}`));
  body.append(canvas);

  const image = ctx2d ? ctx2d.createImageData(FB_WIDTH, FB_HEIGHT) : null;
  const out = image ? new Uint32Array(image.data.buffer) : null;

  return {
    el,
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
