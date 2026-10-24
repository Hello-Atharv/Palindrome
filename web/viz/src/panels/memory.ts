import { DATA_BASE, IN_BASE, SP_REG, STACK_BASE } from '../../../../spec/vm_api';
import { h, hex } from '../dom';
import { changedWords } from '../snapshot';
import { frame } from './panel';
import type { Ctx, Panel } from './panel';

const COLS = 8;
const ROWS = 12;
const WORDS = COLS * ROWS;

type Tab = 'data' | 'stack' | 'input';

/** A fixed grid of hex words. Highlights words that changed since the previous distinct t. */
class HexGrid {
  readonly el = h('div', 'hexgrid');
  private readonly addr: HTMLElement[] = [];
  private readonly cells: HTMLElement[] = [];
  private lastT = -1;
  private lastBase = -1;
  private words: Uint32Array | null = null;
  private before: Uint32Array | null = null;

  constructor() {
    for (let r = 0; r < ROWS; r++) {
      const a = h('span', 'hex-addr');
      this.addr.push(a);
      this.el.append(a);
      for (let c = 0; c < COLS; c++) {
        const cell = h('span', 'hex-cell');
        this.cells.push(cell);
        this.el.append(cell);
      }
    }
  }

  render(base: number, words: Uint32Array, t: number, mark = -1): void {
    if (t !== this.lastT || base !== this.lastBase) {
      this.before = base === this.lastBase ? this.words : null;
      this.lastT = t;
      this.lastBase = base;
    }
    this.words = words;
    const changed = changedWords(this.before, words);
    for (let r = 0; r < ROWS; r++) this.addr[r].textContent = hex(base + r * COLS, 5);
    for (let i = 0; i < WORDS; i++) {
      const c = this.cells[i];
      const v = words[i];
      c.textContent = hex(v);
      c.classList.toggle('zero', v === 0);
      c.classList.toggle('changed', changed.has(i));
      c.classList.toggle('mark', base + i === mark);
    }
  }
}

/** Data / stack / input-window tabs over one hex grid. */
export function memoryPanel(): Panel {
  const { el, body, head } = frame('Memory', 'memory');
  const tabs = h('div', 'tabs');
  const grid = new HexGrid();
  const caption = h('div', 'caption');
  const pager = h('div', 'pager');
  const prevBtn = h('button', 'btn small', '‹');
  const nextBtn = h('button', 'btn small', '›');
  const baseInput = h('input', 'addr-input mono');
  baseInput.value = '00000';
  baseInput.size = 6;
  baseInput.spellcheck = false;
  baseInput.setAttribute('aria-label', 'data address (hex)');
  pager.append(prevBtn, baseInput, nextBtn);
  head.append(tabs);
  body.append(pager, grid.el, caption);

  let tab: Tab = 'data';
  let dataBase = DATA_BASE;
  let latest: Ctx | null = null;

  const tabButtons = (['data', 'stack', 'input'] as const).map((name) => {
    const b = h('button', 'tab', name);
    b.addEventListener('click', () => { tab = name; draw(); });
    tabs.append(b);
    return { name, b };
  });

  const page = (dir: number): void => {
    dataBase = Math.max(0, Math.min(0xffff - WORDS + 1, dataBase + dir * WORDS));
    draw();
  };
  prevBtn.addEventListener('click', () => page(-1));
  nextBtn.addEventListener('click', () => page(1));
  baseInput.addEventListener('change', () => {
    const v = parseInt(baseInput.value, 16);
    if (Number.isFinite(v)) dataBase = Math.max(0, Math.min(0xffff - WORDS + 1, v & ~(COLS - 1)));
    draw();
  });

  function draw(): void {
    tabButtons.forEach(({ name, b }) => b.classList.toggle('active', name === tab));
    pager.hidden = tab !== 'data';
    if (!latest) return;
    const { vm, snap } = latest;
    if (tab === 'data') {
      baseInput.value = hex(dataBase, 5);
      grid.render(dataBase, vm.memory(dataBase, WORDS), snap.t);
      caption.textContent = 'RW data space 0x00000-0x0FFFF';
    } else if (tab === 'stack') {
      const sp = snap.regs[SP_REG];
      grid.render(STACK_BASE, vm.memory(STACK_BASE, WORDS), snap.t, sp);
      caption.textContent = `stack from ${hex(STACK_BASE, 5)}; sp = ${hex(sp, 5)} (outlined), slots at or above sp stay zero`;
    } else {
      grid.render(IN_BASE, vm.memory(IN_BASE, WORDS), snap.t);
      caption.textContent = 'input window (read-only): word 0 = TIME, word 1 = COUNT, then event values';
    }
  }

  return {
    el,
    update(ctx: Ctx) {
      latest = ctx;
      draw();
    },
  };
}
