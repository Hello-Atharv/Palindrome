import { h } from '../dom';
import type { Ctx, Panel } from './panel';

/**
 * Full-width banners, only present when there is something to say:
 *  - direction -1: the PROGRAM runs as its own inverse (not time travel; stepping back never shows this);
 *  - a stopped state: halted, at start, or a fault (state unchanged, with the VM's reason).
 */
export function bannersPanel(): Panel {
  const el = h('div', 'banners');
  el.setAttribute('role', 'status');

  const reverse = h('div', 'banner reverse');
  const rIcon = h('span', 'icon', '◀◀');
  const rText = h('span', '', 'Program running in reverse');
  const rSub = h('small', '', 'direction −1: the program is executing as its own inverse. This is not stepping back in time.');
  reverse.append(rIcon, rText, rSub);

  const stopped = h('div', 'banner');
  const sIcon = h('span', 'icon');
  const sText = h('span');
  const sSub = h('small');
  stopped.append(sIcon, sText, sSub);

  el.append(reverse, stopped);

  return {
    el,
    update({ snap, run }: Ctx) {
      reverse.hidden = snap.direction !== -1;
      const s = run === 'paused' || snap.status !== 'ok' ? snap.status : 'ok';
      const known = s === 'fault' || s === 'halted' || s === 'at_start';
      stopped.hidden = !known;
      if (!known) return;
      stopped.className = `banner ${s === 'fault' ? 'fault' : 'halted'}`;
      if (s === 'fault') {
        sIcon.textContent = '✖';
        sText.textContent = 'Fault';
        sSub.textContent = `${snap.lastError || 'the VM refused the step'}. State is unchanged, so stepping back still works.`;
      } else if (s === 'halted') {
        sIcon.textContent = '■';
        sText.textContent = 'Halted';
        sSub.textContent = `${snap.lastError || 'the program reached HLT'}. Step back to rewind.`;
      } else {
        sIcon.textContent = '⏮';
        sText.textContent = 'At start';
        sSub.textContent = 'Already at t = 0: nothing earlier to step back to.';
      }
    },
  };
}
