import { DATA_BASE, IN_BASE, SP_REG, STACK_BASE } from '../../../../spec/vm_api';
import { h, hex } from '../dom';
import { inGarbage } from '../program';
import type { ProgramInfo } from '../program';
import { changedWords } from '../snapshot';
import type { Ctx, Panel } from './panel';

const COLS = 4;
const ROWS = 10;
const WORDS = COLS * ROWS;
const DATA_LAST = 0xffff;

type Region = 'data' | 'stack' | 'input';

/** The four bytes of a word as text (little-endian), with a dot for anything unprintable. */
export function asciiOf(word: number): string {
  let s = '';
  for (let b = 0; b < 4; b++) {
    const ch = (word >>> (8 * b)) & 255;
    s += ch >= 32 && ch < 127 ? String.fromCharCode(ch) : '·';
  }
  return s;
}

/**
 * A fixed grid of hex words with an ASCII column. Words that changed since the previous distinct t glow in the
 * colour of the time moved; words in a garbage range are hatched.
 */
class HexGrid {
  readonly el = h('div', 'hexgrid');
  private readonly addr: HTMLElement[] = [];
  private readonly ascii: HTMLElement[] = [];
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
      const t = h('span', 'hex-ascii mono');
      this.ascii.push(t);
      this.el.append(t);
    }
  }

  render(base: number, words: Uint32Array, t: number, mark = -1, program: ProgramInfo | null = null, garbage = false): void {
    if (t !== this.lastT || base !== this.lastBase) {
      this.before = base === this.lastBase ? this.words : null;
      this.lastT = t;
      this.lastBase = base;
    }
    this.words = words;
    const changed = changedWords(this.before, words);
    for (let r = 0; r < ROWS; r++) {
      this.addr[r].textContent = hex(base + r * COLS, 5);
      let text = '';
      for (let c = 0; c < COLS; c++) text += asciiOf(words[r * COLS + c]);
      this.ascii[r].textContent = text;
    }
    for (let i = 0; i < WORDS; i++) {
      const c = this.cells[i];
      const v = words[i];
      c.textContent = hex(v);
      c.classList.toggle('zero', v === 0);
      c.classList.toggle('changed', changed.has(i));
      c.classList.toggle('mark', base + i === mark);
      c.classList.toggle('garbage', garbage && inGarbage(program, base + i));
    }
  }
}

/**
 * Memory view: region tabs (data, stack, input window), a paged hex grid with an ASCII column, a jump-to-label
 * menu, a changed-word glow. It reads only the words on screen (SPEC 11.1), and never an unmapped address.
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
  const jump = h('select', 'select small');
  jump.setAttribute('aria-label', 'jump to a data label');
  prevBtn.title = 'previous page';
  nextBtn.title = 'next page';
  pager.append(jump, prevBtn, baseInput, nextBtn);
  bar.append(tabs, pager);
  const grid = new HexGrid();
  const caption = h('div', 'caption');
  el.append(bar, grid.el, caption);

  let region: Region = 'data';
  let dataBase = DATA_BASE;
  let latest: Ctx | null = null;
  let shownProgram: ProgramInfo | null | undefined;
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
  jump.addEventListener('change', () => {
    const a = Number(jump.value);
    if (Number.isFinite(a) && jump.value !== '') dataBase = clampBase(a & ~(COLS - 1));
    jump.value = '';
    draw();
  });

  function fillJump(program: ProgramInfo | null): void {
    jump.replaceChildren(h('option', '', 'jump to…'));
    (jump.firstChild as HTMLOptionElement).value = '';
    for (const l of program?.dataLabels ?? []) {
      const o = h('option', '', `${l.name}  ${hex(l.addr, 4)}`);
      o.value = String(l.addr);
      jump.append(o);
    }
    jump.hidden = (program?.dataLabels.length ?? 0) === 0;
  }

  function draw(): void {
    for (const { name, b } of buttons) b.classList.toggle('active', name === region);
    pager.hidden = region !== 'data';
    if (!latest) return;
    const { vm, snap, program } = latest;
    if (program !== shownProgram) {
      shownProgram = program;
      fillJump(program);
    }
    if (region === 'data') {
      baseInput.value = hex(dataBase, 5);
      grid.render(dataBase, vm.memory(dataBase, WORDS), snap.t, -1, program, true);
      caption.textContent = program && program.garbage.length
        ? 'data space, read-write. Hatched words are garbage: kept because the program cannot erase them.'
        : 'data space 0x00000–0x0FFFF, read-write';
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
