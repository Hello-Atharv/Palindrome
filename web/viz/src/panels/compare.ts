import type { RVM } from '../../../../spec/vm_api';
import { formatBytes, h } from '../dom';
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
  /** The user turned comparing on or off. */
  onToggle(on: boolean): void;
  /** The two machines disagreed at this t (the shell pauses the run). */
  onMismatch(t: number): void;
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

/** Index of the first word that differs, or -1. Also counts non-zero words in `a` (program memory in use). */
export function scanMemory(a: ArrayLike<number>, b: ArrayLike<number>): { diff: number; usedA: number; usedB: number } {
  let diff = -1, usedA = 0, usedB = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== 0) usedA++;
    if (b[i] !== 0) usedB++;
    if (diff < 0 && a[i] !== b[i]) diff = i;
  }
  return { diff, usedA, usedB };
}

/**
 * Compare view: the same program and input on both engines on one shared clock. After every refresh it compares
 * registers, PC and the screen; the whole writable memory a few times a second. Honest about what it shows: rewinding
 * needs no history memory. It does not show that reversible programs are cheaper overall.
 */
export function comparePanel(hooks: CompareHooks): Panel & { setAvailable(ok: boolean, why: string): void } {
  const el = h('div', 'compare');
  const bar = h('div', 'compare-bar');
  const toggle = h('button', 'btn', 'Compare both engines');
  toggle.type = 'button';
  const badge = h('span', 'badge match-badge');
  bar.append(toggle, badge);

  const cards = h('div', 'cmp-cards');
  const card = () => {
    const c = h('div', 'cmp-card');
    const title = h('div', 'cmp-title');
    const sub = h('div', 'cmp-sub dim');
    const hist = h('div', 'cmp-hist mono');
    const used = h('div', 'cmp-used dim');
    c.append(title, sub, h('div', 'tile-label', 'VM history'), hist, used);
    return { c, title, sub, hist, used };
  };
  const left = card();
  const right = card();
  cards.append(left.c, right.c);

  const warn = h('div', 'banner fault cmp-warn');
  warn.append(h('span', 'icon', '⚠'), h('span', '', 'The diary has passed 256 MiB of VM history.'));
  const dismiss = h('button', 'btn small', 'continue');
  dismiss.type = 'button';
  warn.append(dismiss);
  const note = h('p', 'cmp-note dim', 'Both sides run the same program on the same instruction set. This shows that rewinding needs no history memory. It does not show that reversible programs are cheaper overall: they carry garbage and extra instructions.');
  el.append(bar, cards, warn, note);

  let on = false;
  let warnDismissed = false;
  let lastScan = 0;
  let scan = { usedA: -1, usedB: -1, diff: -1 };
  let lastState = 'off';
  toggle.addEventListener('click', () => hooks.onToggle(!on));
  dismiss.addEventListener('click', () => { warnDismissed = true; warn.hidden = true; });

  const paintCard = (c: ReturnType<typeof card>, m: Ctx['machines'][number], used: number): void => {
    const lab = LABELS[m.vm.kind];
    c.title.textContent = lab.title;
    c.sub.textContent = lab.sub;
    c.hist.textContent = formatBytes(m.vm.historyBytes);
    c.c.dataset.engine = m.vm.kind;
    c.used.textContent = used >= 0 ? `${used.toLocaleString('en-GB')} non-zero words of writable memory` : 'program memory: scanning…';
  };

  return {
    el,
    setAvailable(ok, why) {
      toggle.disabled = !ok;
      toggle.title = ok ? 'Run the same program on both engines in lockstep' : why;
    },
    update({ machines, snap }: Ctx) {
      on = machines.length > 1;
      toggle.setAttribute('aria-pressed', String(on));
      toggle.textContent = on ? 'Stop comparing' : 'Compare both engines';
      cards.hidden = !on;
      note.hidden = !on;
      warn.hidden = true;
      if (!on) {
        badge.textContent = 'one engine';
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
      badge.textContent = diff ? `✖ states differ at t = ${snap.t}: ${diff}` : '✔ state match';
      if (state === 'diff' && lastState !== 'diff') hooks.onMismatch(snap.t);
      lastState = state;

      paintCard(left, a, scan.usedA);
      paintCard(right, b, scan.usedB);
      const logging = machines.find((m) => m.vm.kind === 'logging');
      warn.hidden = warnDismissed || !logging || logging.vm.historyBytes < HISTORY_WARN_BYTES;
    },
  };
}
