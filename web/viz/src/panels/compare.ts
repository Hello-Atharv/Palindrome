import { consoleText } from '../../../../lang/src/console';
import type { RVM, VmKind } from '../../../../spec/vm_api';
import { formatBytes, h } from '../dom';
import { icon } from '../icons';
import { formatMs, formatNs, garbageBitsOf } from '../track';
import type { TrackResult } from '../track';
import { benchSection } from './bench';
import { framebufferView } from './framebuffer';
import type { Ctx, Panel } from './panel';

/** SPEC 11.1: warn when the diary's history passes this much. */
export const HISTORY_WARN_BYTES = 256 * 1024 * 1024;
/** The whole writable memory is data + stack + framebuffer = 0x20800 words (SPEC 11.1). */
const WRITABLE_WORDS = 0x20800;
/** Full memory scans cost about 1 ms per 100k words; do them a few times a second at most. */
const SCAN_EVERY_MS = 250;
const CONSOLE_LINES = 4;

/** SPEC 12.4: the logging VM is a naive diary and is called that wherever it is shown. */
const ENGINES = {
  logging: { title: 'Naive diary', sub: 'the logging engine: 48 bytes for every step' },
  reversible: { title: 'Reversible', sub: 'keeps no history of its steps' },
} as const;
const COLOUR: Record<VmKind, string> = { logging: '#8fa8ff', reversible: '#3fb950' };

export interface CompareHooks {
  /** The two machines disagreed at this t (the shell pauses the run). */
  onMismatch(t: number): void;
  /** Run the program forward and back on both engines and report memory and time. */
  onMeasure(): Promise<TrackResult[]>;
}

/** Result of comparing two machines: first difference found, or null. */
export function firstDifference(a: RVM, b: RVM, ra: ArrayLike<number>, rb: ArrayLike<number>, pcs: [number, number], fba: ArrayLike<number>, fbb: ArrayLike<number>): string | null {
  if (pcs[0] !== pcs[1]) return `pc ${pcs[0]} vs ${pcs[1]}`;
  for (let i = 0; i < 16; i++) if (ra[i] !== rb[i]) return `r${i}`;
  for (let i = 0; i < fba.length; i++) if (fba[i] !== fbb[i]) return `screen pixel ${i}`;
  if (a.instructionCount !== b.instructionCount) return 't';
  if (a.direction !== b.direction) return 'direction';
  return null;
}

/** Index of the first word that differs, or -1. Also counts non-zero words in each (what the program wrote). */
export function scanMemory(a: ArrayLike<number>, b: ArrayLike<number>): { diff: number; usedA: number; usedB: number } {
  let diff = -1, usedA = 0, usedB = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== 0) usedA++;
    if (b[i] !== 0) usedB++;
    if (diff < 0 && a[i] !== b[i]) diff = i;
  }
  return { diff, usedA, usedB };
}

/** History plus garbage, in bits (SPEC 12.1): the total cost of being able to undo. */
export const totalBits = (historyBytes: number, garbageBits: number): number => historyBytes * 8 + garbageBits;
const fmtBits = (n: number): string => `${n.toLocaleString('en-GB')} bit${n === 1 ? '' : 's'}`;

/** 1-2-5 ceiling, for the top of an axis. */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 5, 10]) if (m * pow >= v) return m * pow;
  return 10 * pow;
}

const NS = 'http://www.w3.org/2000/svg';
function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, text?: string): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
}

/** The "VM history against time" chart: bytes the machine keeps, over the steps of the run, one line per engine. */
export function historyChart(results: readonly TrackResult[]): SVGSVGElement {
  const W = 640, H = 262, L = 64, R = 150, T = 14, B = 48;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'cmp-chart-svg', role: 'img' });
  const steps = Math.max(1, ...results.map((r) => r.steps));
  const top = niceMax(Math.max(0, ...results.map((r) => Math.max(...r.samples.map((s) => s.bytes)))));
  svg.setAttribute('aria-label', `VM history in bytes against steps, up to ${steps} steps. ${results.map((r) => `${ENGINES[r.kind].title}: ${formatBytes(r.historyBytes)}`).join('. ')}.`);
  const x = (t: number): number => L + (t / steps) * (W - L - R);
  const y = (b: number): number => H - B - (b / top) * (H - T - B);

  for (let i = 0; i <= 4; i++) {
    const v = (top * i) / 4;
    svg.append(
      svgEl('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'cmp-grid' }),
      svgEl('text', { x: L - 8, y: y(v) + 4, class: 'cmp-tick', 'text-anchor': 'end' }, formatBytes(Math.round(v))),
    );
  }
  for (let i = 0; i <= 4; i++) {
    const t = Math.round((steps * i) / 4);
    svg.append(svgEl('text', { x: x(t), y: H - 26, class: 'cmp-tick', 'text-anchor': i === 0 ? 'start' : i === 4 ? 'end' : 'middle' }, t.toLocaleString('en-GB')));
  }
  svg.append(svgEl('text', { x: (L + W - R) / 2, y: H - 6, class: 'cmp-axis', 'text-anchor': 'middle' }, 'steps run (t)'));

  const endY: number[] = [];
  results.forEach((r) => {
    const pts = r.samples.map((s) => `${x(s.t).toFixed(1)},${y(s.bytes).toFixed(1)}`).join(' ');
    svg.append(svgEl('polyline', { points: pts, class: 'cmp-line', stroke: COLOUR[r.kind] }));
    const last = r.samples[r.samples.length - 1];
    let ly = y(last.bytes);
    while (endY.some((e) => Math.abs(e - ly) < 16)) ly -= 16; // two lines ending at the same height: their labels do not overlap
    endY.push(ly);
    svg.append(
      svgEl('circle', { cx: x(last.t), cy: y(last.bytes), r: 4, fill: COLOUR[r.kind] }),
      svgEl('text', { x: x(last.t) + 10, y: ly + 4, class: 'cmp-end', fill: COLOUR[r.kind] }, `${ENGINES[r.kind].title} ${formatBytes(r.historyBytes)}`),
    );
  });
  return svg;
}

const REG_NAMES = Array.from({ length: 16 }, (_, i) => (i === 14 ? 'sp' : `r${i}`));

/**
 * The Compare tab. A controls row (given by the shell) on top, then both engines side by side in lockstep, then the
 * measured memory-against-time chart and table. Honest about what it shows: rewinding needs no history memory; it does
 * not show that reversible programs are cheaper overall (they carry garbage and extra instructions).
 */
export function comparePanel(hooks: CompareHooks, controls: HTMLElement): Panel & { setAvailable(ok: boolean, why: string): void } {
  const el = h('div', 'compare');
  const body = h('div', 'cmp-body');

  // ---- the two engines ----
  const mismatch = h('p', 'cmp-mismatch');
  mismatch.hidden = true;
  const cards = h('div', 'cmp-cards');
  const makeCard = (kind: VmKind) => {
    const c = h('article', 'cmp-card');
    c.dataset.engine = kind;
    c.style.setProperty('--engine', COLOUR[kind]);
    const stats = h('dl', 'cmp-stats');
    const stat = (label: string, hint: string) => {
      const dt = h('dt', '', label);
      dt.title = hint;
      const dd = h('dd', 'mono');
      stats.append(dt, dd);
      return dd;
    };
    const hist = stat('History memory', 'history_bytes: what the machine keeps so that it can step back');
    const garbage = stat('Garbage', 'garbage_bits: what the program keeps because it cannot erase it. The console buffer counts as garbage.');
    const total = stat('Total', 'history_bytes × 8 + garbage_bits');
    const written = stat('Program data written', 'non-zero words in writable memory');
    const regs = h('div', 'cmp-regs mono');
    const regCells = [...REG_NAMES, 'pc'].map((name) => {
      const cell = h('div', 'cmp-reg');
      const val = h('span', 'cmp-regval');
      cell.append(h('span', 'cmp-regname dim', name), val);
      regs.append(cell);
      return { cell, val };
    });
    const fb = framebufferView(`${ENGINES[kind].title} screen`);
    fb.setScale(3);
    const lines = h('div', 'cmp-console mono');
    lines.setAttribute('aria-label', `${ENGINES[kind].title} console, last lines`);
    const screenRow = h('div', 'cmp-screen');
    screenRow.append(fb.el, lines);
    const time = h('p', 'cmp-time dim');
    const head = h('header', 'cmp-card-head');
    head.append(h('h3', 'cmp-title', ENGINES[kind].title), h('span', 'dim', ENGINES[kind].sub));
    c.append(head, stats, regs, screenRow, time);
    return { c, hist, garbage, total, written, regCells, fb, lines, time, prevRegs: [] as number[] };
  };
  const diary = makeCard('logging');
  const reversible = makeCard('reversible');
  const byKind: Record<VmKind, ReturnType<typeof makeCard>> = { logging: diary, reversible };
  cards.append(diary.c, reversible.c);

  const warn = h('div', 'banner fault cmp-warn');
  warn.append(icon('warn'), h('strong', '', 'The diary has passed 256 MiB of history.'));
  const dismiss = h('button', 'btn small', 'Continue');
  dismiss.type = 'button';
  warn.append(dismiss);
  warn.hidden = true;

  // ---- memory against time, measured ----
  const chartBox = h('section', 'cmp-section');
  const chartHead = h('div', 'cmp-head');
  const measure = h('button', 'btn primary');
  measure.type = 'button';
  measure.append(icon('play'), h('span', '', 'Measure both engines'));
  chartHead.append(h('h3', 'cmp-h', 'VM history against time'), measure);
  const task = h('p', 'dim cmp-sub', 'Runs the program on a fresh copy of each engine until it halts, or for its first 100,000 steps, then runs it back to t = 0, and repeats until the times are steady.');
  const chartSlot = h('div', 'cmp-chart');
  const table = h('div', 'cmp-table');
  table.hidden = true;
  const verdict = h('p', 'cmp-verdict');
  verdict.hidden = true;
  chartBox.append(chartHead, task, chartSlot, table, verdict);

  const note = h('p', 'cmp-note dim', 'Both engines run the same program on the same instruction set. This shows that rewinding needs no history memory. It does not show that reversible programs are cheaper overall: they carry garbage and extra instructions.');
  body.append(mismatch, cards, warn, chartBox, benchSection(), note);
  el.append(controls, body);

  let warnDismissed = false;
  let lastScan = 0;
  let scan = { usedA: -1, usedB: -1, diff: -1 };
  let lastState = 'off';
  let measuring = false;
  let garbageRanges: readonly (readonly [number, number])[] = [];
  let timing: Partial<Record<VmKind, TrackResult>> = {};
  let program: object | null | undefined;
  dismiss.addEventListener('click', () => { warnDismissed = true; warn.hidden = true; });

  measure.addEventListener('click', async () => {
    if (measuring) return;
    measuring = true;
    measure.disabled = true;
    verdict.hidden = false;
    verdict.textContent = 'Measuring…';
    try {
      show(await hooks.onMeasure());
    } catch (e) {
      table.hidden = true;
      verdict.textContent = e instanceof Error ? e.message : String(e);
    } finally {
      measuring = false;
      measure.disabled = false;
    }
  });

  function show(results: TrackResult[]): void {
    timing = {};
    for (const r of results) timing[r.kind] = r;
    chartSlot.replaceChildren(historyChart(results));
    const diaryR = timing.logging, revR = timing.reversible;

    const head = h('div', 'trow thead');
    ['Strategy', 'History', 'Garbage', 'Total', 'Forward', 'Back'].forEach((t) => head.append(h('span', '', t)));
    table.replaceChildren(head);
    const row = (name: string, r: TrackResult | undefined, planned = false): void => {
      const tr = h('div', `trow${planned ? ' planned' : ''}`);
      tr.append(h('span', 'tlabel', name));
      if (!r) {
        tr.append(h('span', 'tplanned dim', planned ? 'planned: defined in SPEC 12.3, not built yet' : 'not measured'));
      } else {
        for (const v of [formatBytes(r.historyBytes), fmtBits(r.garbageBits), fmtBits(totalBits(r.historyBytes, r.garbageBits)), `${formatNs(r.forwardNs)} / step`, `${formatNs(r.backNs)} / step`]) tr.append(h('span', 'tcell mono', v));
      }
      table.append(tr);
    };
    row('Naive diary', diaryR);
    row('Reversible', revR);
    row('Tight diary', undefined, true);
    row('Checkpoint and replay', undefined, true);
    table.hidden = false;

    const a = diaryR, b = revR;
    if (a && b) {
      const slow = b.backNs / Math.max(a.backNs, 1e-9);
      verdict.textContent =
        `${a.steps.toLocaleString('en-GB')} steps${a.capped ? ' (the first part of a longer run)' : ''}, averaged over ${a.passes.toLocaleString('en-GB')} passes. ` +
        `The diary keeps ${formatBytes(a.historyBytes)} to be able to go back; the reversible engine keeps ${formatBytes(b.historyBytes)}. ` +
        `Its back track takes ${slow >= 1 ? `${slow.toFixed(1)} times as long` : `${(1 / slow).toFixed(1)} times less time`} as the diary's (${formatMs(b.backMs)} against ${formatMs(a.backMs)}). ` +
        `${a.restored && b.restored ? 'Both engines returned to exactly the starting state.' : 'An engine did not return to the starting state.'}`;
    }
    verdict.hidden = false;
  }

  const paintCard = (c: ReturnType<typeof makeCard>, vm: RVM, written: number): void => {
    const hist = vm.historyBytes;
    const garbage = garbageBitsOf(vm, garbageRanges);
    c.hist.textContent = formatBytes(hist);
    c.garbage.textContent = fmtBits(garbage);
    c.total.textContent = fmtBits(totalBits(hist, garbage));
    c.written.textContent = written >= 0 ? `${written.toLocaleString('en-GB')} words` : 'scanning…';
    const { regs, pc } = vm.registers();
    const values = [...Array.from(regs), pc];
    c.regCells.forEach(({ cell, val }, i) => {
      val.textContent = i === 16 ? String(pc) : String(values[i] | 0); // signed decimal; the pc is an address
      cell.classList.toggle('changed', c.prevRegs.length > 0 && c.prevRegs[i] !== values[i]);
    });
    c.prevRegs = values;
    c.fb.draw(vm.framebuffer());
    const lines = consoleText((a, n) => vm.memory(a, n)).split('\n').filter((l, i, all) => l !== '' || i < all.length - 1);
    c.lines.replaceChildren(...lines.slice(-CONSOLE_LINES).map((l) => h('div', '', l === '' ? ' ' : l)));
    c.lines.hidden = lines.length === 0;
    const t = timing[vm.kind];
    c.time.textContent = t ? `Forward ${formatNs(t.forwardNs)} per step, back ${formatNs(t.backNs)} per step` : 'Time per step: press Measure both engines.';
  };

  return {
    el,
    setAvailable(ok, why) {
      measure.disabled = !ok || measuring;
      measure.title = ok ? 'Run the program forward and back on both engines' : why;
    },
    update({ machines, snap, program: p }: Ctx) {
      if (p !== program) {
        program = p;
        garbageRanges = p?.garbage ?? [];
        timing = {};
        chartSlot.replaceChildren();
        table.hidden = true;
        verdict.hidden = true;
        warnDismissed = false;
      }
      if (machines.length < 2) {
        el.dataset.live = 'false';
        lastState = 'off';
        return;
      }
      el.dataset.live = 'true';
      const [a, b] = machines;
      const ra = a.vm.registers();
      const rb = b.vm.registers();
      let diff = firstDifference(a.vm, b.vm, ra.regs, rb.regs, [ra.pc, rb.pc], snap.fb, b.vm.framebuffer());
      const now = performance.now();
      if (now - lastScan >= SCAN_EVERY_MS) {
        lastScan = now;
        scan = scanMemory(a.vm.memory(0, WRITABLE_WORDS), b.vm.memory(0, WRITABLE_WORDS));
      }
      if (!diff && scan.diff >= 0) diff = `memory word 0x${scan.diff.toString(16)}`;
      const state = diff ? 'diff' : 'match';
      mismatch.hidden = state === 'match';
      if (diff) mismatch.textContent = `The engines differ at t = ${snap.t}: ${diff}.`;
      if (state === 'diff' && lastState !== 'diff') hooks.onMismatch(snap.t);
      lastState = state;

      paintCard(byKind[a.vm.kind], a.vm, scan.usedA);
      paintCard(byKind[b.vm.kind], b.vm, scan.usedB);
      const logging = machines.find((m) => m.vm.kind === 'logging');
      warn.hidden = warnDismissed || !logging || logging.vm.historyBytes < HISTORY_WARN_BYTES;
    },
  };
}
