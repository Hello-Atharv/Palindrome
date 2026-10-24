import type { Transport } from '../controls';
import { formatBytes, h } from '../dom';
import { icon } from '../icons';
import type { IconName } from '../icons';
import type { Ctx, Panel } from './panel';

/** Round up to 1, 2 or 5 times a power of ten. */
export function niceCeil(v: number): number {
  const pow = 10 ** Math.floor(Math.log10(Math.max(1, v)));
  for (const m of [1, 2, 5, 10]) if (m * pow >= v) return m * pow;
  return 10 * pow;
}

/** Tick spacing in steps: the smallest 1-2-5 step whose ticks are at least `minPx` apart. */
export function tickStep(domain: number, widthPx: number, minPx: number): number {
  const pxPerStep = widthPx / domain;
  for (let pow = 1; ; pow *= 10) for (const m of [1, 2, 5]) if (m * pow * pxPerStep >= minPx) return m * pow;
}

const STATE: Record<string, { icon: IconName; text: string }> = {
  fwd: { icon: 'play', text: 'Running forward' },
  back: { icon: 'playBack', text: 'Running back' },
  paused: { icon: 'pause', text: 'Paused' },
  halted: { icon: 'halt', text: 'Halted' },
  at_start: { icon: 'stepBack', text: 'At the start' },
  fault: { icon: 'warn', text: 'Fault' },
};

/**
 * The debug bar at the foot of the editor: small controls, the instruction count, the state, and a tape strip (ticks,
 * the furthest point reached, the fork point and the discarded future). Dragging the strip is reported through `onSeek`;
 * the shell decides what a seek does.
 */
export function timelinePanel(transport: Transport, onSeek: (t: number) => void): Panel {
  const el = h('section', 'debugbar');
  el.setAttribute('aria-label', 'debug controls and timeline');

  const top = h('div', 'dbg-top');
  const tNum = h('span', 't-num mono');
  const tBox = h('span', 't-box');
  tBox.append(h('span', 'dim', 't'), tNum);
  top.append(transport.el, tBox);

  const strip = h('div', 'strip');
  strip.tabIndex = 0;
  strip.setAttribute('role', 'slider');
  strip.setAttribute('aria-label', 'time scrubber');
  const lost = h('div', 'strip-lost');
  const future = h('div', 'strip-future');
  const fill = h('div', 'strip-fill');
  const ticks = h('div', 'strip-ticks');
  const maxMark = h('div', 'strip-max');
  const branchMark = h('div', 'strip-branch');
  const handle = h('div', 'strip-handle');
  strip.append(lost, future, fill, ticks, maxMark, branchMark, handle);

  const status = h('div', 'dbg-status');
  const state = h('span', 'dbg-state');
  const hist = h('span', 'dbg-hist dim');
  const fork = h('span', 'dbg-fork');
  fork.append(icon('fork', 14), h('span', '', 'New timeline'));
  fork.title = 'A key press or direction flip while scrubbed back discarded the rest of the old timeline';
  fork.hidden = true;
  status.append(state, hist, fork);
  el.append(top, strip, status);

  let domain = 64;
  let tickKey = '';
  const pct = (t: number): string => `${(Math.min(t, domain) / domain) * 100}%`;

  const seekFromEvent = (ev: PointerEvent): void => {
    const r = strip.getBoundingClientRect();
    onSeek(Math.max(0, Math.round(((ev.clientX - r.left) / r.width) * domain)));
  };
  strip.addEventListener('pointerdown', (ev) => {
    strip.setPointerCapture(ev.pointerId);
    seekFromEvent(ev);
  });
  strip.addEventListener('pointermove', (ev) => {
    if (strip.hasPointerCapture(ev.pointerId)) seekFromEvent(ev);
  });

  function drawTicks(width: number): void {
    const step = tickStep(domain, width, 36);
    const key = `${domain}/${step}/${Math.round(width)}`;
    if (key === tickKey) return;
    tickKey = key;
    ticks.replaceChildren();
    for (let v = 0; v <= domain; v += step) {
      const major = (v / step) % 5 === 0;
      const tick = h('span', `tick${major ? ' major' : ''}`);
      tick.style.left = pct(v);
      ticks.append(tick);
      if (major) {
        const label = h('span', 'tick-label', v.toLocaleString('en-GB'));
        label.style.left = pct(v);
        ticks.append(label);
      }
    }
  }

  return {
    el,
    update({ snap, maxT, branch, branchAt, lostTo, run, vm }: Ctx) {
      tNum.textContent = snap.t.toLocaleString('en-GB');
      const far = Math.max(maxT, lostTo ?? 0, snap.t, 64);
      domain = niceCeil(far * 1.1);
      drawTicks(strip.clientWidth || 380);

      fill.style.width = pct(snap.t);
      handle.style.left = pct(snap.t);
      future.style.left = pct(snap.t);
      future.style.width = `${((Math.max(maxT, snap.t) - snap.t) / domain) * 100}%`;
      maxMark.style.left = pct(maxT);
      maxMark.classList.toggle('flip', maxT / domain > 0.8);
      maxMark.classList.toggle('merged', branchAt === maxT);
      strip.setAttribute('aria-valuemin', '0');
      strip.setAttribute('aria-valuemax', String(maxT));
      strip.setAttribute('aria-valuenow', String(snap.t));

      const forked = branchAt !== null && lostTo !== null;
      branchMark.hidden = !forked;
      lost.hidden = !forked || lostTo <= (branchAt ?? 0);
      if (forked) {
        branchMark.style.left = pct(branchAt);
        lost.style.left = pct(branchAt);
        lost.style.width = `${((lostTo - branchAt) / domain) * 100}%`;
      }
      fork.hidden = !branch;

      // one state, in order of importance: a stopped state beats the run state
      const key = run !== 'paused' ? run : snap.status === 'ok' ? 'paused' : snap.status;
      const st = STATE[key] ?? STATE.paused;
      state.dataset.state = key;
      state.replaceChildren(icon(st.icon, 14), h('span', '', st.text));
      hist.textContent = `${vm.kind === 'logging' ? 'Diary' : 'Reversible'} history ${formatBytes(snap.historyBytes)}`;
    },
  };
}
