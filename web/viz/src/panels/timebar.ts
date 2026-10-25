import { h } from '../dom';
import { icon } from '../icons';
import type { IconName } from '../icons';

/** The bar's width in instructions when the sphere animation sets the pace. */
export const ANIMATED_CAPACITY = 20;
/** The bar's width at the top speed (no steady rate to multiply). */
export const MAX_SPEED_CAPACITY = 500_000;
/** How many seconds of running fill the bar at a steady speed. */
export const SECONDS_TO_FILL = 5;

/**
 * How many instructions the bar holds. It never needs the length of the program, which is not known before it has run:
 * it is what the current speed gets through in five seconds, so a steady run fills it in five seconds.
 */
export function capacityFor(animated: boolean, hz: number): number {
  if (animated) return ANIMATED_CAPACITY;
  if (!Number.isFinite(hz)) return MAX_SPEED_CAPACITY;
  return Math.max(1, Math.round(hz * SECONDS_TO_FILL));
}

/**
 * The stretch of time the bar shows. Until the machine has run `capacity` instructions the bar is [0, capacity] and
 * fills from the left. After that it is full, and slides: its right end is always the latest t, its left end
 * `capacity` instructions before. So the end of the bar always means "now", however long the run has been.
 */
export function windowFor(latest: number, capacity: number): { start: number; end: number } {
  const end = Math.max(capacity, latest);
  return { start: end - capacity, end };
}

const STATE: Record<string, { icon: IconName; text: string }> = {
  ready: { icon: 'pause', text: 'ready' },
  fwd: { icon: 'play', text: 'running' },
  back: { icon: 'playBack', text: 'running back' },
  paused: { icon: 'pause', text: 'paused' },
  halted: { icon: 'halt', text: 'halted' },
  at_start: { icon: 'stepBack', text: 'at the start' },
  fault: { icon: 'warn', text: 'fault' },
};

export interface TimeBarState {
  t: number;
  /** Furthest t reached on this branch. */
  latest: number;
  capacity: number;
  run: 'fwd' | 'back' | 'paused';
  status: string;
  branchAt: number | null;
  lostTo: number | null;
  /** A game's frame number: shown in place of t, which moves to the label. */
  frame?: number | null;
}

export interface TimeBar {
  el: HTMLElement;
  update(s: TimeBarState): void;
}

/**
 * The run-time bar: `t N` at the left, a track with a knob, the state at the right. Click or drag the track to move
 * through time (up to the furthest point reached). The shell decides what a seek does.
 */
export function timeBar(onSeek: (t: number) => void): TimeBar {
  const el = h('div', 'tbar');
  const label = h('div', 'tbar-label dim');
  const row = h('div', 'tbar-row');
  const tBox = h('span', 'tbar-t');
  const tNum = h('span', 'mono tbar-num');
  const tName = h('span', 'dim', 't');
  tBox.append(tName, tNum);

  const track = h('div', 'tbar-track');
  track.tabIndex = 0;
  track.setAttribute('role', 'slider');
  track.setAttribute('aria-label', 'run time');
  const lost = h('div', 'tbar-lost');
  const future = h('div', 'tbar-future');
  const fill = h('div', 'tbar-fill');
  const knob = h('div', 'tbar-knob');
  track.append(lost, future, fill, knob);

  const state = h('span', 'tbar-state');
  row.append(tBox, track, state);
  el.append(label, row);

  let cur: TimeBarState = { t: 0, latest: 0, capacity: ANIMATED_CAPACITY, run: 'paused', status: 'ok', branchAt: null, lostTo: null };
  const view = () => windowFor(Math.max(cur.latest, cur.t), cur.capacity);
  const pct = (t: number, start: number): number => Math.min(100, Math.max(0, ((t - start) / cur.capacity) * 100));

  const seekFromEvent = (ev: PointerEvent): void => {
    const r = track.getBoundingClientRect();
    const { start } = view();
    const t = Math.round(start + Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)) * cur.capacity);
    onSeek(Math.min(Math.max(0, t), Math.max(cur.latest, cur.t)));
  };
  track.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    track.focus();
    track.setPointerCapture(ev.pointerId);
    seekFromEvent(ev);
  });
  track.addEventListener('pointermove', (ev) => {
    if (track.hasPointerCapture(ev.pointerId)) seekFromEvent(ev);
  });
  track.addEventListener('keydown', (ev) => {
    const to = ev.key === 'ArrowLeft' ? cur.t - 1 : ev.key === 'ArrowRight' ? cur.t + 1 : ev.key === 'Home' ? 0 : ev.key === 'End' ? cur.latest : null;
    if (to === null) return;
    ev.preventDefault();
    onSeek(Math.min(Math.max(0, to), Math.max(cur.latest, cur.t)));
  });

  return {
    el,
    update(s) {
      cur = s;
      const { start } = view();
      const game = s.frame !== null && s.frame !== undefined;
      tName.textContent = game ? 'frame' : 't';
      tNum.textContent = (game ? s.frame! : s.t).toLocaleString('en-GB');
      label.textContent = `Run time${game ? `, t ${s.t.toLocaleString('en-GB')}` : ''}, full at ${s.capacity.toLocaleString('en-GB')} instructions`;
      const latest = Math.max(s.latest, s.t);
      fill.style.width = `${pct(s.t, start)}%`;
      knob.style.left = `${pct(s.t, start)}%`;
      future.style.left = `${pct(s.t, start)}%`;
      future.style.width = `${Math.max(0, pct(latest, start) - pct(s.t, start))}%`;
      const forked = s.branchAt !== null && s.lostTo !== null && s.lostTo > s.branchAt;
      lost.hidden = !forked;
      if (forked) {
        const a = pct(s.branchAt!, start), b = pct(s.lostTo!, start);
        lost.style.left = `${a}%`;
        lost.style.width = `${Math.max(0, b - a)}%`;
      }
      track.setAttribute('aria-valuemin', String(start));
      track.setAttribute('aria-valuemax', String(latest));
      track.setAttribute('aria-valuenow', String(s.t));
      track.setAttribute('aria-valuetext', game ? `frame ${s.frame!.toLocaleString('en-GB')}, t ${s.t.toLocaleString('en-GB')}` : `t ${s.t.toLocaleString('en-GB')}`);

      // one state, in order of importance: a stopped state beats the run state
      const key = s.run !== 'paused' ? s.run : s.status !== 'ok' ? s.status : s.t === 0 ? 'ready' : 'paused';
      const st = STATE[key] ?? STATE.paused;
      state.dataset.state = key;
      state.title = st.text;
      state.replaceChildren(icon(st.icon, 14), h('span', '', st.text));
    },
  };
}
