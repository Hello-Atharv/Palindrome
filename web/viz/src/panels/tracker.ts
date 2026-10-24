import { formatBytes, h } from '../dom';
import type { Ctx, Panel } from './panel';

const SVG = 'http://www.w3.org/2000/svg';
const MAX_SAMPLES = 400;

const ENGINE_NAME = {
  logging: 'Diary: keeps history',
  reversible: 'Reversible: no history',
} as const;

function tile(label: string): { el: HTMLElement; val: HTMLElement } {
  const el = h('div', 'tile');
  const val = h('div', 'tile-val');
  el.append(h('div', 'tile-label', label), val);
  return { el, val };
}

/**
 * The tracker strip (t, steps/s, FRAME, engine) and the history tile, the project's headline number:
 * what the VM itself holds so it can rewind. Reversible engine: 0 B per step (green). Logging engine: grows with t.
 * The sparkline plots historyBytes against t on the current branch.
 */
export function trackerPanel(): Panel {
  const el = h('div', 'tracker');

  const history = h('div', 'tile history');
  const left = h('div', 'history-left');
  const num = h('div', 'history-num');
  const note = h('div', 'history-note');
  const labelRow = h('div', 'history-label');
  labelRow.append(h('span', 'tile-label', 'VM history'), note);
  left.append(labelRow, num);
  const spark = document.createElementNS(SVG, 'svg');
  spark.setAttribute('class', 'spark');
  spark.setAttribute('viewBox', '0 0 100 40');
  spark.setAttribute('preserveAspectRatio', 'none');
  spark.setAttribute('role', 'img');
  const base = document.createElementNS(SVG, 'line');
  base.setAttribute('class', 'base');
  base.setAttribute('x1', '0'); base.setAttribute('x2', '100'); base.setAttribute('y1', '39'); base.setAttribute('y2', '39');
  const line = document.createElementNS(SVG, 'polyline');
  line.setAttribute('class', 'line');
  spark.append(base, line);
  history.append(left, spark);

  const tiles = h('div', 'tiles');
  const tT = tile('t');
  const tRate = tile('steps/s');
  const tFrame = tile('FRAME');
  const tEngine = tile('engine');
  tiles.append(tT.el, tRate.el, tFrame.el, tEngine.el);
  el.append(history, tiles);

  /** (t, bytes) on the current branch, ascending in t. Stepping back drops the samples above t. */
  let samples: [number, number][] = [];

  function record(t: number, bytes: number): void {
    while (samples.length && samples[samples.length - 1][0] >= t) samples.pop();
    samples.push([t, bytes]);
    if (samples.length > MAX_SAMPLES) samples = samples.filter((_, i) => i % 2 === 0 || i === samples.length - 1);
  }

  function draw(): void {
    const tMax = Math.max(1, samples[samples.length - 1]?.[0] ?? 1);
    const bMax = Math.max(1, ...samples.map((s) => s[1]));
    line.setAttribute('points', samples.map(([t, b]) => `${(t / tMax) * 100},${39 - (b / bMax) * 37}`).join(' '));
  }

  return {
    el,
    update({ vm, snap, rate, frame }: Ctx) {
      record(snap.t, snap.historyBytes);
      draw();
      history.dataset.engine = vm.kind;
      num.textContent = formatBytes(snap.historyBytes);
      note.textContent = snap.t > 0 ? `${(snap.historyBytes / snap.t).toFixed(1)} B per step` : 'bytes the VM holds to rewind';
      spark.setAttribute('aria-label', `VM history against time: ${formatBytes(snap.historyBytes)} at t = ${snap.t}`);
      tT.val.textContent = snap.t.toLocaleString('en-GB');
      tRate.val.textContent = rate === null ? '–' : rate >= 1000 ? `${(rate / 1000).toFixed(1)}k` : String(Math.round(rate));
      tFrame.val.textContent = String(frame);
      tEngine.val.textContent = ENGINE_NAME[vm.kind];
    },
  };
}
