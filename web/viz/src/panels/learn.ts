import { STACK_BASE } from '../../../../spec/vm_api';
import { Diagram } from '../datapath/diagram';
import { buildScript, decodeWord, mnemonic } from '../datapath/script';
import { disassemble } from '../disasm';
import { h, hex } from '../dom';
import { learnVerdict } from '../program';
import type { ProgramInfo } from '../program';
import type { Ctx, Panel } from './panel';

const DATA_WORDS = 64;
const STACK_WORDS = 16;
const COLS = 4;
const PHASE_MS = 450;
/** Skip the animation when a step has less time than this per phase (faster runs use the heat map instead). */
const MIN_PHASE_MS = 40;

type Format = 'signed' | 'unsigned' | 'hex';
const FORMATS: Record<Format, (v: number) => string> = {
  signed: (v) => String(v | 0),
  unsigned: (v) => String(v >>> 0),
  hex: (v) => hex(v),
};

/** A small fixed window of memory: 4 words per row, with a highlight for the word being read or written. */
class Window {
  readonly el = h('div', 'lw');
  private readonly cells: HTMLElement[] = [];
  private readonly addrs: HTMLElement[] = [];
  private before: Uint32Array | null = null;

  constructor(readonly base: number, readonly words: number) {
    for (let r = 0; r < words / COLS; r++) {
      const a = h('span', 'lw-addr');
      this.addrs.push(a);
      this.el.append(a);
      for (let c = 0; c < COLS; c++) {
        const cell = h('span', 'lw-cell');
        this.cells.push(cell);
        this.el.append(cell);
      }
    }
  }

  has(addr: number): boolean {
    return addr >= this.base && addr < this.base + this.words;
  }

  render(words: Uint32Array, fmt: (v: number) => string, mark = -1): void {
    for (let r = 0; r < this.addrs.length; r++) this.addrs[r].textContent = hex(this.base + r * COLS, 5);
    words.forEach((v, i) => {
      const c = this.cells[i];
      c.textContent = fmt(v);
      c.classList.toggle('zero', v === 0);
      c.classList.toggle('changed', this.before !== null && this.before[i] !== v);
      c.classList.toggle('mark', this.base + i === mark);
      c.classList.remove('read', 'write');
    });
    this.before = words;
  }

  /** Light the word at `addr` while it is being read or written. */
  touch(addr: number, mode: 'read' | 'write'): void {
    this.cells.forEach((c) => c.classList.remove('read', 'write'));
    if (this.has(addr)) this.cells[addr - this.base].classList.add(mode);
  }
}

/**
 * The Learn view, modelled on a classroom CPU simulator: the program on the left, the datapath in the middle
 * (registers, incrementer, MAR, MBR, CIR, control unit, ALU, input, output, a bus, and packets of data that travel while
 * an instruction executes), a small fixed window of memory on the right. All of the machine's memory and registers
 * still exist and run; only 64 data words and 16 stack words are drawn. Only for simple programs (see learnVerdict).
 */
export function learnPanel(): Panel {
  const el = h('div', 'learn');

  // left: the program
  const codeBox = h('section', 'panel learn-code');
  const codeHead = h('header', 'panel-head');
  codeHead.append(h('h2', 'panel-title', 'Program'));
  const codeList = h('div', 'lc-list');
  codeBox.append(codeHead, codeList);

  // middle: info box + diagram
  const mid = h('div', 'learn-mid');
  const note = h('div', 'learn-note');
  note.setAttribute('role', 'status');
  const diagram = new Diagram({
    onNote: (t) => { note.textContent = t; },
    onCode: (addr) => markCode(addr, 'fetch'),
    onMem: (addr, mode) => { data.touch(addr, mode); stack.touch(addr, mode); },
  });
  const diagramBox = h('div', 'learn-dp');
  const tag = h('span', 'badge dp-badge', 'illustrative: inferred from each instruction, the VM exposes no datapath events');
  diagramBox.append(diagram.el, tag);
  mid.append(note, diagramBox);

  // right: memory windows
  const memBox = h('section', 'panel learn-mem');
  const memBody = h('div', 'learn-mem-body');
  const fmtSelect = h('select', 'select small');
  fmtSelect.setAttribute('aria-label', 'number format');
  for (const f of ['signed', 'unsigned', 'hex'] as const) {
    const o = h('option', '', f);
    o.value = f;
    fmtSelect.append(o);
  }
  const data = new Window(0, DATA_WORDS);
  const stack = new Window(STACK_BASE, STACK_WORDS);
  const titleRow = (text: string, withSelect = false): HTMLElement => {
    const r = h('div', 'lm-title');
    r.append(h('span', '', text));
    if (withSelect) r.append(fmtSelect);
    return r;
  };
  memBody.append(
    titleRow('Data memory, words 0–63', true), data.el,
    titleRow(`Stack, ${hex(STACK_BASE, 5)}…`), stack.el,
    h('p', 'caption', '80 of the 133,120 writable words are drawn; all of memory still exists and runs.'),
  );
  memBox.append(memBody);

  const off = h('div', 'empty learn-off');
  el.append(codeBox, mid, memBox, off);

  let fmt = FORMATS.signed;
  let program: ProgramInfo | null | undefined;
  let code: Uint32Array = new Uint32Array(0);
  let rows: HTMLElement[] = [];
  let latest: Ctx | null = null;
  let lastT = -1;
  let stale = true;
  let animId = 0;

  fmtSelect.addEventListener('change', () => {
    fmt = FORMATS[fmtSelect.value as Format];
    diagram.setFormat(fmt);
    if (latest) settle(latest);
  });

  function buildList(info: ProgramInfo): void {
    const text = (addr: number): string => info.listing?.find((r) => r.addr === addr)?.text.trim() ?? (() => {
      const d = disassemble(code[addr], info.labels);
      return `${d.mnemonic} ${d.operands}`.trim();
    })();
    rows = Array.from(code, (_, addr) => {
      const row = h('div', 'lc-row');
      row.append(h('span', 'lc-addr mono', String(addr).padStart(3, '0')), h('span', 'lc-text mono', text(addr)));
      return row;
    });
    codeList.replaceChildren(...rows);
  }

  function markCode(addr: number, kind: 'now' | 'fetch'): void {
    rows.forEach((r, i) => {
      r.classList.toggle('now', kind === 'now' && i === addr);
      r.classList.toggle('fetch', kind === 'fetch' && i === addr);
    });
  }

  /** Show a state with no animation: registers, memory windows, the current instruction. */
  function settle(ctx: Ctx): void {
    const { vm, snap } = ctx;
    diagram.show(snap.regs, snap.pc);
    data.render(vm.memory(0, DATA_WORDS), fmt);
    stack.render(vm.memory(STACK_BASE, STACK_WORDS), fmt, snap.regs[14]);
    markCode(snap.pc, 'now');
    if (snap.pc < code.length) {
      note.textContent = `Next: ${mnemonic(decodeWord(code[snap.pc]))}  (at PC ${snap.pc}). Press Step to watch it run.`;
    } else {
      note.textContent = `PC ${snap.pc} is outside the program.`;
    }
  }

  function animate(ctx: Ctx): boolean {
    const { snap: cur, prev } = ctx;
    if (!prev) return false;
    const reversed = cur.t < prev.t || prev.direction === -1;
    const pc = reversed ? cur.pc : prev.pc;
    if (pc >= code.length) return false;
    const phases = buildScript({
      word: code[pc],
      pc,
      pcAfter: reversed ? prev.pc : cur.pc,
      before: reversed ? cur.regs : prev.regs,
      after: reversed ? prev.regs : cur.regs,
    });
    const phaseMs = ctx.run === 'paused' ? PHASE_MS : Math.min(PHASE_MS, 850 / ctx.stepHz / phases.length);
    if (phaseMs < MIN_PHASE_MS) return false;
    const id = ++animId;
    markCode(pc, 'now');
    void diagram
      .play(phases, { reversed, phaseMs, before: reversed ? cur.regs : prev.regs, after: reversed ? prev.regs : cur.regs, pcBefore: pc, pcAfter: reversed ? prev.pc : cur.pc })
      .then(() => { if (id === animId && latest) settle(latest); });
    return true;
  }

  return {
    el,
    update(ctx: Ctx) {
      latest = ctx;
      const verdict = learnVerdict(ctx.program);
      off.hidden = verdict.ok;
      for (const part of [codeBox, mid, memBox]) part.hidden = !verdict.ok;
      off.textContent = verdict.why;
      if (!verdict.ok) {
        program = undefined;
        return;
      }
      if (ctx.program !== program) {
        program = ctx.program;
        code = ctx.program!.codeLen > 0 ? ctx.vm.code(0, ctx.program!.codeLen) : new Uint32Array(0);
        buildList(ctx.program!);
        diagram.clearUnits();
        lastT = -1;
        stale = true;
      }
      if (ctx.view !== 'learn') {
        stale = true;
        return;
      }
      const t = ctx.snap.t;
      const step = !stale && !ctx.heat && lastT >= 0 && ctx.prev !== null && Math.abs(t - ctx.prev.t) === 1 && t !== lastT;
      lastT = t;
      stale = false;
      animId++;
      if (step && animate(ctx)) return;
      diagram.cancel();
      settle(ctx);
    },
  };
}
