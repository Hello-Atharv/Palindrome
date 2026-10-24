import type { RVM } from '../../../../spec/vm_api';
import { formatBytes, h } from '../dom';
import { icon } from '../icons';
import { formatMs } from '../track';
import type { TrackResult } from '../track';
import type { Ctx, Panel } from './panel';

/** SPEC 11.1: warn when the diary's history passes this much. */
export const HISTORY_WARN_BYTES = 256 * 1024 * 1024;
/** The whole writable memory is data + stack + framebuffer = 0x20800 words (SPEC 11.1). */
const WRITABLE_WORDS = 0x20800;
/** Full memory scans cost about 1 ms per 100k words; do them a few times a second at most. */
const SCAN_EVERY_MS = 250;

const LABELS = {
  logging: { title: 'Diary', sub: 'Normal rewind, keeps a diary' },
  reversible: { title: 'Reversible', sub: 'No history' },
} as const;

export interface CompareHooks {
  /** The user turned the side-by-side run on or off. */
  onToggle(on: boolean): void;
  /** The two machines disagreed at this t (the shell pauses the run). */
  onMismatch(t: number): void;
  /** Run the program forward and back on both engines and report time and memory. */
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

/** Index of the first word that differs, or -1. Also counts non-zero words in each (program memory in use). */
export function scanMemory(a: ArrayLike<number>, b: ArrayLike<number>): { diff: number; usedA: number; usedB: number } {
  let diff = -1, usedA = 0, usedB = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== 0) usedA++;
    if (b[i] !== 0) usedB++;
    if (diff < 0 && a[i] !== b[i]) diff = i;
  }
  return { diff, usedA, usedB };
}

interface Row {
  label: string;
  tone: 'fwd' | 'back' | 'mem';
  values: [string, string];
  /** Bar lengths 0..1 for the diary and the reversible engine. */
  bars: [number, number];
}

/** The rows of the track table, with bars scaled to the larger of the two in each row. */
export function trackRows(a: TrackResult, b: TrackResult): Row[] {
  const scale = (x: number, y: number): [number, number] => {
    const m = Math.max(x, y);
    return m === 0 ? [0, 0] : [x / m, y / m];
  };
  return [
    { label: `Forward track, t = 0 to ${a.steps}`, tone: 'fwd', values: [formatMs(a.forwardMs), formatMs(b.forwardMs)], bars: scale(a.forwardMs, b.forwardMs) },
    { label: `Back track, t = ${a.steps} to 0`, tone: 'back', values: [formatMs(a.backMs), formatMs(b.backMs)], bars: scale(a.backMs, b.backMs) },
    { label: 'History memory after the forward track', tone: 'mem', values: [formatBytes(a.historyBytes), formatBytes(b.historyBytes)], bars: scale(a.historyBytes, b.historyBytes) },
  ];
}

/**
 * The Compare tab. Top: the two engines running in lockstep with a state-match check. Below: a forward-track and
 * back-track measurement of time and memory for each engine. Honest about what it shows: rewinding needs no history
 * memory. It does not show that reversible programs are cheaper overall: they carry garbage and extra instructions.
 */
export function comparePanel(hooks: CompareHooks): Panel & { setAvailable(ok: boolean, why: string): void } {
  const el = h('div', 'compare');

  // ---- measurement ----
  const track = h('section', 'cmp-section');
  const trackHead = h('div', 'cmp-head');
  const measure = h('button', 'btn primary');
  measure.type = 'button';
  measure.append(icon('play'), h('span', '', 'Measure forward and back tracks'));
  measure.title = 'Run this program forward to its end and back to the start on a fresh copy of each engine';
  trackHead.append(h('h3', 'cmp-h', 'Forward track and back track'), measure);
  const trackNote = h('p', 'dim cmp-sub', 'Runs this program from t = 0 to its end, then rewinds it to t = 0, on a fresh copy of each engine, and repeats until the time is steady.');
  const table = h('div', 'cmp-table');
  table.hidden = true;
  const verdict = h('p', 'cmp-verdict');
  verdict.hidden = true;
  track.append(trackHead, trackNote, table, verdict);

  // ---- live, side by side ----
  const live = h('section', 'cmp-section');
  const liveHead = h('div', 'cmp-head');
  const toggle = h('button', 'btn');
  toggle.type = 'button';
  const badge = h('span', 'match');
  liveHead.append(h('h3', 'cmp-h', 'Live, side by side'), toggle, badge);
  const cards = h('div', 'cmp-cards');
  const card = () => {
    const c = h('div', 'cmp-card');
    const title = h('div', 'cmp-title');
    const sub = h('div', 'cmp-sub dim');
    const hist = h('div', 'cmp-hist mono');
    const used = h('div', 'cmp-used dim');
    c.append(title, sub, h('div', 'dim', 'History memory'), hist, used);
    return { c, title, sub, hist, used };
  };
  const left = card();
  const right = card();
  cards.append(left.c, right.c);
  const warn = h('div', 'banner fault cmp-warn');
  warn.append(icon('warn'), h('strong', '', 'The diary has passed 256 MiB of history.'));
  const dismiss = h('button', 'btn small', 'Continue');
  dismiss.type = 'button';
  warn.append(dismiss);
  const hint = h('p', 'dim cmp-sub', 'Turn this on to run both engines on the same program and input at once, with every step, step back and key press applied to both.');
  live.append(liveHead, hint, cards, warn);
  const note = h('p', 'cmp-note dim', 'Both engines run the same program on the same instruction set. This shows that rewinding needs no history memory. It does not show that reversible programs are cheaper overall: they carry garbage and extra instructions.');
  el.append(track, live, note);

  let on = false;
  let warnDismissed = false;
  let lastScan = 0;
  let scan = { usedA: -1, usedB: -1, diff: -1 };
  let lastState = 'off';
  let measuring = false;
  toggle.addEventListener('click', () => hooks.onToggle(!on));
  dismiss.addEventListener('click', () => { warnDismissed = true; warn.hidden = true; });

  measure.addEventListener('click', async () => {
    if (measuring) return;
    measuring = true;
    measure.disabled = true;
    verdict.hidden = false;
    verdict.textContent = 'Measuring…';
    try {
      const [a, b] = await hooks.onMeasure();
      showTable(a, b);
    } catch (e) {
      table.hidden = true;
      verdict.textContent = e instanceof Error ? e.message : String(e);
    } finally {
      measuring = false;
      measure.disabled = false;
    }
  });

  function showTable(a: TrackResult, b: TrackResult): void {
    const head = h('div', 'trow thead');
    head.append(h('span'), h('span', '', 'Diary'), h('span', '', 'Reversible'));
    table.replaceChildren(head);
    for (const r of trackRows(a, b)) {
      const row = h('div', 'trow');
      row.append(h('span', 'tlabel', r.label));
      r.values.forEach((v, i) => {
        const cell = h('span', `tcell ${r.tone}`);
        const bar = h('span', 'tbar');
        bar.style.width = `${Math.max(r.bars[i] * 100, r.bars[i] > 0 ? 2 : 0)}%`;
        cell.append(h('span', 'tval mono', v), bar);
        row.append(cell);
      });
      table.append(row);
    }
    table.hidden = false;
    const slow = b.backMs / Math.max(a.backMs, 1e-9);
    verdict.textContent =
      `${a.steps.toLocaleString('en-GB')} steps${a.capped ? ' (the first part of a longer run)' : ''}, averaged over ${a.passes.toLocaleString('en-GB')} passes. ` +
      `The diary keeps ${formatBytes(a.historyBytes)} to be able to go back; the reversible engine keeps ${formatBytes(b.historyBytes)}. ` +
      `Its back track takes ${slow >= 1 ? `${slow.toFixed(1)} times as long` : `${(1 / slow).toFixed(1)} times less time`} as the diary's. ` +
      `${a.restored && b.restored ? 'Both engines returned to exactly the starting state.' : 'An engine did not return to the starting state.'} ` +
      `${a.endDigest === b.endDigest ? 'Both ended in the same state.' : 'They ended in different states.'}`;
    verdict.hidden = false;
  }

  const paintCard = (c: ReturnType<typeof card>, m: Ctx['machines'][number], used: number): void => {
    const lab = LABELS[m.vm.kind];
    c.title.textContent = lab.title;
    c.sub.textContent = lab.sub;
    c.hist.textContent = formatBytes(m.vm.historyBytes);
    c.c.dataset.engine = m.vm.kind;
    c.used.textContent = used >= 0 ? `${used.toLocaleString('en-GB')} non-zero words of writable memory` : 'Scanning memory…';
  };

  return {
    el,
    setAvailable(ok, why) {
      toggle.disabled = !ok;
      measure.disabled = !ok || measuring;
      toggle.title = ok ? 'Run both engines in lockstep' : why;
      measure.title = ok ? measure.title : why;
    },
    update({ machines, snap }: Ctx) {
      on = machines.length > 1;
      toggle.setAttribute('aria-pressed', String(on));
      toggle.textContent = on ? 'Stop side by side' : 'Run side by side';
      cards.hidden = !on;
      hint.hidden = on;
      warn.hidden = true;
      if (!on) {
        badge.textContent = '';
        badge.dataset.state = 'off';
        lastState = 'off';
        return;
      }
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
      badge.dataset.state = state;
      badge.replaceChildren(icon(diff ? 'cross' : 'check', 14), h('span', '', diff ? `States differ at t = ${snap.t}: ${diff}` : 'States match'));
      if (state === 'diff' && lastState !== 'diff') hooks.onMismatch(snap.t);
      lastState = state;

      paintCard(left, a, scan.usedA);
      paintCard(right, b, scan.usedB);
      const logging = machines.find((m) => m.vm.kind === 'logging');
      warn.hidden = warnDismissed || !logging || logging.vm.historyBytes < HISTORY_WARN_BYTES;
    },
  };
}
