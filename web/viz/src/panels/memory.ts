import { DATA_BASE, IN_BASE, SP_REG, STACK_BASE } from '../../../../spec/vm_api';
import { h, hex } from '../dom';
import { changedWords } from '../snapshot';
import type { Ctx, Panel } from './panel';

const COLS = 4;
const ROWS = 10;
const WORDS = COLS * ROWS;
const DATA_LAST = 0xffff;

type Region = 'data' | 'stack' | 'input';

/** A fixed grid of hex words. Words that changed since the previous distinct t glow in the colour of the time moved. */
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

/**
 * Memory view: region tabs (data, stack, input window), a paged hex grid, a changed-word glow.
 * It reads only the words on screen (SPEC 11.1), and never an unmapped address.
 */
export function memoryPanel(): Panel {
  const el = h('div', 'memory');
  const bar = h('div', 'memory-bar');
  const tabs = h('div', 'region-tabs');
  const pager = h('div', 'pager');
  const prevBtn = h('button', 'btn small', '‹');
  const nextBtn = h('button', 'btn small', '›');
  const baseInput = h('input', 'addr-input mono');
  baseInput.size = 6;
  baseInput.spellcheck = false;
  baseInput.setAttribute('aria-label', 'data address (hex)');
  prevBtn.title = 'previous page';
  nextBtn.title = 'next page';
  pager.append(prevBtn, baseInput, nextBtn);
  bar.append(tabs, pager);
  const grid = new HexGrid();
  const caption = h('div', 'caption');
  el.append(bar, grid.el, caption);

  let region: Region = 'data';
  let dataBase = DATA_BASE;
  let latest: Ctx | null = null;
  const clampBase = (v: number): number => Math.max(0, Math.min(DATA_LAST - WORDS + 1, v));

  const buttons = (['data', 'stack', 'input'] as const).map((name) => {
    const b = h('button', 'tab', name);
    b.type = 'button';
    b.addEventListener('click', () => { region = name; draw(); });
    tabs.append(b);
    return { name, b };
  });
  for (const b of [prevBtn, nextBtn]) b.type = 'button';
  prevBtn.addEventListener('click', () => { dataBase = clampBase(dataBase - WORDS); draw(); });
  nextBtn.addEventListener('click', () => { dataBase = clampBase(dataBase + WORDS); draw(); });
  baseInput.addEventListener('change', () => {
    const v = parseInt(baseInput.value, 16);
    if (Number.isFinite(v)) dataBase = clampBase(v & ~(COLS - 1));
    draw();
  });

  function draw(): void {
    for (const { name, b } of buttons) b.classList.toggle('active', name === region);
    pager.hidden = region !== 'data';
    if (!latest) return;
    const { vm, snap } = latest;
    if (region === 'data') {
      baseInput.value = hex(dataBase, 5);
      grid.render(dataBase, vm.memory(dataBase, WORDS), snap.t);
      caption.textContent = 'data space 0x00000–0x0FFFF, read-write';
    } else if (region === 'stack') {
      const sp = snap.regs[SP_REG];
      grid.render(STACK_BASE, vm.memory(STACK_BASE, WORDS), snap.t, sp);
      caption.textContent = `stack from ${hex(STACK_BASE, 5)}; sp = ${hex(sp, 5)} (outlined). Slots at or above sp stay zero.`;
    } else {
      grid.render(IN_BASE, vm.memory(IN_BASE, WORDS), snap.t);
      caption.textContent = 'input window, read-only: word 0 = TIME, word 1 = COUNT, then event values';
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
