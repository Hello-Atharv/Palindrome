import { Op } from '../../../../spec/vm_api';
import { disassemble } from '../disasm';
import { h, hex } from '../dom';
import { frame } from './panel';
import type { Ctx, Panel } from './panel';

const ROW_H = 22;
const VISIBLE_ROWS = 18;
const POOL = VISIBLE_ROWS + 4;

const KIND: Partial<Record<Op, string>> = {
  [Op.BR]: 'flow', [Op.LND]: 'flow', [Op.CALL]: 'flow', [Op.PROC]: 'flow', [Op.RET]: 'flow',
  [Op.HLT]: 'halt', [Op.NOP]: 'nop',
  [Op.XLD]: 'mem', [Op.XST]: 'mem',
};

export interface LineClick {
  /** Code address of the clicked line. */
  addr: number;
  /** True if the click landed in the breakpoint gutter. */
  gutter: boolean;
  shiftKey: boolean;
}

/** What the debugger can do with the code listing. The listing never decides what a click means. */
export interface ListingApi {
  /** Called for every click on a line. Returns an unsubscribe function. */
  onLineClick(fn: (e: LineClick) => void): () => void;
  /** Draw a breakpoint dot in the gutter of exactly these code addresses. */
  setBreakpoints(addrs: readonly number[]): void;
  /** Highlight one "culprit" line (for example the instruction that last wrote a watched value); null clears it. */
  setCulprit(addr: number | null): void;
  /** Scroll so this address is in view (turns off follow-PC until the PC moves again). */
  scrollTo(addr: number): void;
  /** Keep the PC line in view as it moves (default true). */
  followPc: boolean;
}

interface Row {
  row: HTMLElement;
  addr: HTMLElement;
  word: HTMLElement;
  label: HTMLElement;
  mn: HTMLElement;
  ops: HTMLElement;
}

/**
 * Scrollable disassembly of the whole program, virtualised (only about 22 rows exist in the DOM).
 * The current PC is marked automatically; breakpoints and the culprit line are set through ListingApi.
 */
export function listingPanel(): Panel & { api: ListingApi } {
  const { el, body, head } = frame('Listing', 'listing');
  const current = h('span', 'badge mono');
  const followBox = h('input');
  followBox.type = 'checkbox';
  followBox.checked = true;
  const followLabel = h('label', 'follow');
  followLabel.append(followBox, h('span', '', 'follow pc'));
  head.append(current, followLabel);

  const scroller = h('div', 'listing-scroll');
  scroller.style.height = `${VISIBLE_ROWS * ROW_H}px`;
  scroller.tabIndex = 0;
  scroller.setAttribute('aria-label', 'code listing');
  const spacer = h('div', 'listing-spacer');
  const layer = h('div', 'listing-rows');
  spacer.append(layer);
  scroller.append(spacer);
  body.append(scroller);
  body.classList.add('listing-body');

  const rows: Row[] = Array.from({ length: POOL }, () => {
    const row = h('div', 'dis-row');
    row.style.height = `${ROW_H}px`;
    const gutter = h('span', 'dis-gutter');
    gutter.title = 'breakpoint gutter';
    const r = { row, addr: h('span', 'dis-addr'), word: h('span', 'dis-word'), label: h('span', 'dis-label'), mn: h('span', 'dis-mn'), ops: h('span', 'dis-ops') };
    row.append(gutter, r.addr, r.word, r.label, r.mn, r.ops);
    layer.append(row);
    return r;
  });

  let code: Uint32Array = new Uint32Array(0);
  let labels: ReadonlyMap<number, string> | undefined;
  let program: object | null = null;
  let pc = 0;
  let lastT = -1;
  let breakpoints = new Set<number>();
  let culprit: number | null = null;
  let queued = false;
  const listeners = new Set<(e: LineClick) => void>();

  function render(): void {
    queued = false;
    const first = Math.max(0, Math.min(Math.floor(scroller.scrollTop / ROW_H), Math.max(0, code.length - POOL)));
    layer.style.transform = `translateY(${first * ROW_H}px)`;
    rows.forEach((r, i) => {
      const a = first + i;
      const visible = a < code.length;
      r.row.hidden = !visible;
      if (!visible) return;
      const w = code[a];
      const d = disassemble(w, labels);
      r.row.dataset.addr = String(a);
      r.row.classList.toggle('current', a === pc);
      r.row.classList.toggle('bp', breakpoints.has(a));
      r.row.classList.toggle('culprit', a === culprit);
      r.addr.textContent = String(a).padStart(4, ' ');
      r.word.textContent = hex(w);
      r.label.textContent = labels?.get(a) ?? '';
      r.mn.textContent = d.mnemonic;
      r.mn.dataset.kind = KIND[(w >>> 26) as Op] ?? 'alu';
      r.ops.textContent = d.operands;
    });
  }
  const schedule = (): void => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(render);
    }
  };
  scroller.addEventListener('scroll', schedule, { passive: true });

  scroller.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement;
    const row = target.closest<HTMLElement>('.dis-row');
    if (!row || row.dataset.addr === undefined) return;
    const e: LineClick = { addr: Number(row.dataset.addr), gutter: target.closest('.dis-gutter') !== null, shiftKey: ev.shiftKey };
    listeners.forEach((fn) => fn(e));
  });

  function reveal(addr: number, centre: boolean): void {
    const top = addr * ROW_H;
    const view = VISIBLE_ROWS * ROW_H;
    if (centre || top < scroller.scrollTop + ROW_H || top > scroller.scrollTop + view - 3 * ROW_H) {
      scroller.scrollTop = Math.max(0, top - view / 2);
    }
  }

  const api: ListingApi = {
    onLineClick(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    setBreakpoints(addrs) {
      breakpoints = new Set(addrs);
      schedule();
    },
    setCulprit(addr) {
      culprit = addr;
      schedule();
    },
    scrollTo(addr) {
      followBox.checked = false;
      reveal(addr, true);
      schedule();
    },
    get followPc() { return followBox.checked; },
    set followPc(on: boolean) { followBox.checked = on; },
  };

  return {
    el,
    api,
    update({ vm, snap, program: info }: Ctx) {
      if (info !== program) { // a new program: fetch its code once (it is read-only)
        program = info;
        labels = info?.labels;
        code = info && info.codeLen > 0 ? vm.code(0, info.codeLen) : new Uint32Array(0);
        spacer.style.height = `${code.length * ROW_H}px`;
        scroller.scrollTop = 0;
        lastT = -1;
      }
      pc = snap.pc;
      const word = pc < code.length ? code[pc] : 0;
      const d = disassemble(word, labels);
      current.textContent = pc < code.length ? `pc ${pc} · ${d.mnemonic} ${d.operands}`.trim() : `pc ${pc}`;
      if (snap.t !== lastT) {
        lastT = snap.t;
        if (followBox.checked) reveal(pc, false);
      }
      render();
    },
  };
}
