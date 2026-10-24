import { h } from '../dom';
import { icon } from '../icons';
import type { IconName } from '../icons';
import type { Ctx, Panel } from './panel';

/**
 * Slim notices, only present when there is something to say:
 *  - direction -1: the PROGRAM runs as its own inverse (not time travel; stepping back never shows this);
 *  - a stopped state: halted, at the start, a fault (state unchanged, with the VM's reason), or a load that failed.
 */
export function bannersPanel(): Panel {
  const el = h('div', 'banners');
  el.setAttribute('role', 'status');

  const reverse = h('div', 'banner reverse');
  reverse.append(
    icon('reverse'),
    h('strong', '', 'Program running in reverse'),
    h('span', 'banner-sub', 'Direction −1: the program executes as its own inverse. This is not stepping back in time.'),
  );

  const stopped = h('div', 'banner');
  const sText = h('strong');
  const sSub = h('span', 'banner-sub');
  stopped.append(h('span', 'banner-icon'), sText, sSub);
  el.append(reverse, stopped);

  const setIcon = (name: IconName): void => stopped.firstElementChild!.replaceChildren(icon(name));

  return {
    el,
    update({ snap, run, notice }: Ctx) {
      reverse.hidden = snap.direction !== -1;
      const s = run === 'paused' || snap.status !== 'ok' ? snap.status : 'ok';
      const known = s === 'fault' || s === 'halted' || s === 'at_start' || s === 'bad_program' || s === 'bad_arg';
      stopped.hidden = !known;
      if (!known) return;
      stopped.className = `banner ${s === 'halted' || s === 'at_start' ? 'halted' : 'fault'}`;
      if (s === 'bad_program' || s === 'bad_arg') {
        setIcon('warn');
        sText.textContent = 'Could not load';
        sSub.textContent = notice || snap.lastError || 'The program was rejected.';
      } else if (s === 'fault') {
        setIcon('warn');
        sText.textContent = 'Fault';
        sSub.textContent = `${snap.lastError || 'The VM refused the step'}. State is unchanged, so stepping back still works.`;
      } else if (s === 'halted') {
        setIcon('halt');
        sText.textContent = 'Halted';
        sSub.textContent = `${snap.lastError || 'The program reached HLT'}. Step back to rewind.`;
      } else {
        setIcon('stepBack');
        sText.textContent = 'At the start';
        sSub.textContent = 'Already at t = 0: nothing earlier to step back to.';
      }
    },
  };
}
