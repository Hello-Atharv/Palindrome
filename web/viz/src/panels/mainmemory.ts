import { STACK_BASE } from '../../../../spec/vm_api';
import type { RVM } from '../../../../spec/vm_api';
import { decodeWord, mnemonic } from '../datapath/script';
import { h } from '../dom';

export const DATA_WORDS = 64;
export const STACK_WORDS = 16;
const COLS = 4;
/** Height of a sticky region header, so a revealed row is not hidden under it. */
const HEAD_PX = 28;

/** An address with its region letter and a fixed width, so every row label lines up: P00003, D00060, S65536. */
export const rowLabel = (space: 'P' | 'D' | 'S', addr: number): string => `${space}${String(addr).padStart(5, '0')}`;

/** A block of data words, four to a row. */
class Words {
  readonly el = h('div', 'mm-words');
  private readonly cells: HTMLElement[] = [];
  private before: Uint32Array | null = null;

  constructor(space: 'D' | 'S', readonly base: number, readonly count: number) {
    for (let r = 0; r < count / COLS; r++) {
      this.el.append(h('span', 'mm-addr mono', rowLabel(space, base + r * COLS)));
      for (let c = 0; c < COLS; c++) {
        const cell = h('span', 'mm-cell mono');
        this.cells.push(cell);
        this.el.append(cell);
      }
    }
  }

  has(addr: number): boolean {
    return addr >= this.base && addr < this.base + this.count;
  }

  rowOf(addr: number): HTMLElement {
    return this.cells[Math.floor((addr - this.base) / COLS) * COLS];
  }

  render(words: Uint32Array, mark: number): void {
    words.forEach((v, i) => {
      const c = this.cells[i];
      c.textContent = String(v | 0); // signed decimal everywhere
      c.classList.toggle('zero', v === 0);
      c.classList.toggle('changed', this.before !== null && this.before[i] !== v);
      c.classList.toggle('mark', this.base + i === mark);
      c.classList.remove('read', 'write');
    });
    this.before = words;
  }

  touch(addr: number, mode: 'read' | 'write'): void {
    this.cells.forEach((c) => c.classList.remove('read', 'write'));
    if (this.has(addr)) this.cells[addr - this.base].classList.add(mode);
  }
}

export interface MainMemory {
  el: HTMLElement;
  /** A new program: one row per instruction. */
  setProgram(code: Uint32Array): void;
  /** Redraw from the machine: program counter, data and stack. */
  render(vm: RVM, pc: number, sp: number): void;
  /** The fetch reads the program word at `addr`. */
  touchProgram(addr: number): void;
  /** A load or store at a data or stack address. */
  touchData(addr: number, mode: 'read' | 'write'): void;
  /** Scroll to the program counter's row. */
  followPc(pc: number): void;
}

/**
 * One scrolling table for everything the machine can address, as in a von Neumann computer: Program, Data and Stack,
 * each under a header that stays at the top while its rows scroll. The view scrolls to where the machine is working.
 * It is a presentation: the real machine keeps code in a separate read-only space (a Harvard architecture, by design).
 */
export function mainMemory(): MainMemory {
  const el = h('div', 'mm');
  el.tabIndex = 0;
  el.setAttribute('aria-label', 'main memory: program, data and stack');

  const section = (title: string, hint: string) => {
    const box = h('section', 'mm-sec');
    const head = h('h3', 'mm-head');
    head.append(h('span', '', title), h('span', 'mm-hint dim', hint));
    const body = h('div', 'mm-body');
    box.append(head, body);
    return { box, body, head };
  };

  const prog = section('Program', 'read-only');
  const data = section('Data', 'words 0–63');
  const stack = section('Stack', `from ${STACK_BASE}`);
  const dataWords = new Words('D', 0, DATA_WORDS);
  const stackWords = new Words('S', STACK_BASE, STACK_WORDS);
  data.body.append(dataWords.el);
  stack.body.append(stackWords.el);
  const note = h('p', 'mm-note dim', 'One table for display. The machine keeps the program in a separate, read-only memory (a Harvard design, on purpose).');
  el.append(prog.box, data.box, stack.box, note);

  let rows: HTMLElement[] = [];

  function reveal(row: HTMLElement | undefined): void {
    if (!row) return;
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < el.scrollTop + HEAD_PX) el.scrollTop = Math.max(0, top - HEAD_PX - 4);
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight + 4;
  }

  return {
    el,
    setProgram(code) {
      rows = Array.from(code, (word, i) => {
        const row = h('div', 'mm-prow');
        row.append(
          h('span', 'mm-addr mono', rowLabel('P', i)),
          h('span', 'mm-hex mono', `0x${(word >>> 0).toString(16).padStart(8, '0')}`),
          h('span', 'mm-op mono', mnemonic(decodeWord(word))),
        );
        return row;
      });
      prog.body.replaceChildren(...rows);
      prog.box.hidden = rows.length === 0;
    },
    render(vm, pc, sp) {
      rows.forEach((r, i) => {
        r.classList.toggle('cur', i === pc);
        r.classList.remove('read');
      });
      dataWords.render(vm.memory(0, DATA_WORDS), -1);
      stackWords.render(vm.memory(STACK_BASE, STACK_WORDS), sp);
    },
    touchProgram(addr) {
      rows.forEach((r) => r.classList.remove('read'));
      rows[addr]?.classList.add('read');
      reveal(rows[addr]);
    },
    touchData(addr, mode) {
      dataWords.touch(addr, mode);
      stackWords.touch(addr, mode);
      if (dataWords.has(addr)) reveal(dataWords.rowOf(addr));
      else if (stackWords.has(addr)) reveal(stackWords.rowOf(addr));
    },
    followPc(pc) {
      reveal(rows[pc]);
    },
  };
}
