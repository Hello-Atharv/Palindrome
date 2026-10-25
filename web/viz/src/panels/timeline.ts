import type { Transport } from '../controls';
import { formatBytes, h } from '../dom';
import { icon } from '../icons';
import type { Ctx, Panel } from './panel';
import { timeBar } from './timebar';

/** The run-time bar as a panel, fed from the shell's context. */
export function timeBarPanel(onSeek: (t: number) => void): Panel {
  const bar = timeBar(onSeek);
  return {
    el: bar.el,
    update({ snap, maxT, branchAt, lostTo, run, capacity }: Ctx) {
      bar.update({ t: snap.t, latest: maxT, capacity, run, status: snap.status, branchAt, lostTo });
    },
  };
}

/**
 * The debug bar at the foot of the editor: small controls, the run-time bar, and one line for the history size and a
 * fork notice. Dragging the bar is reported through `onSeek`; the shell decides what a seek does.
 */
export function timelinePanel(transport: Transport, onSeek: (t: number) => void): Panel {
  const el = h('section', 'debugbar');
  el.setAttribute('aria-label', 'debug controls and run time');

  const top = h('div', 'dbg-top');
  top.append(transport.el);

  const bar = timeBarPanel(onSeek);

  const status = h('div', 'dbg-status');
  const hist = h('span', 'dbg-hist dim');
  const fork = h('span', 'dbg-fork');
  fork.append(icon('fork', 14), h('span', '', 'New timeline'));
  fork.title = 'A key press or direction flip while scrubbed back discarded the rest of the old timeline';
  fork.hidden = true;
  status.append(hist, fork);
  el.append(top, bar.el, status);

  return {
    el,
    update(ctx: Ctx) {
      const { snap, branch, vm } = ctx;
      bar.update(ctx);
      fork.hidden = !branch;
      hist.textContent = `${vm.kind === 'logging' ? 'Diary' : 'Reversible'} history ${formatBytes(snap.historyBytes)}`;
    },
  };
}
