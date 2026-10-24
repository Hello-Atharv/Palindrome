import { STACK_BASE } from '../../../../spec/vm_api';
import { Diagram, PACES } from '../datapath/diagram';
import type { PaceName } from '../datapath/diagram';
import { buildScript, decodeWord, mnemonic } from '../datapath/script';
import { h, hex } from '../dom';
import { learnVerdict } from '../program';
import type { Ctx, Panel } from './panel';

const DATA_WORDS = 64;
const STACK_WORDS = 16;
const COLS = 4;
/** Above this many steps per second a run is too fast to follow: the picture jumps instead of animating. */
const ANIMATE_MAX_HZ = 20;

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
      const a = h('span', 'lw-addr mono');
      this.addrs.push(a);
      this.el.append(a);
      for (let c = 0; c < COLS; c++) {
        const cell = h('span', 'lw-cell mono');
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

export type VisualisePanel = Panel & {
  /** True while an instruction is being animated: a run waits for it. */
  busy(): boolean;
  /** Whether the animation is on screen and slow enough to pace a run. */
  paces(ctx: Ctx): boolean;
};

/**
 * The Visualisation tab: the datapath with a sphere that travels along each wire, and a small fixed window of memory.
 * All of the machine's memory and registers still exist and run; only 64 data words and 16 stack words are drawn.
 * Only for simple programs (see learnVerdict).
 */
export function visualisePanel(): VisualisePanel {
  const el = h('div', 'vis');

  // controls: pace and number format
  const bar = h('div', 'vis-bar');
  const note = h('div', 'vis-note');
  note.setAttribute('role', 'status');
  const paceBox = h('div', 'segmented');
  paceBox.setAttribute('role', 'group');
  paceBox.setAttribute('aria-label', 'animation speed');
  const fmtSelect = h('select', 'select tiny');
  fmtSelect.setAttribute('aria-label', 'number format');
  for (const f of ['signed', 'unsigned', 'hex'] as const) {
    const o = h('option', '', f);
    o.value = f;
    fmtSelect.append(o);
  }
  bar.append(note, h('span', 'dim', 'Animation'), paceBox, fmtSelect);

  // the diagram
  const diagram = new Diagram({
    onNote: (t) => { note.textContent = t; },
    onCode: () => {},
    onMem: (addr, mode) => { data.touch(addr, mode); stack.touch(addr, mode); },
  });
  const dpBox = h('div', 'vis-dp');
  dpBox.append(diagram.el, h('p', 'vis-caption dim', 'Illustrative: the VM exposes no datapath events, so each move is inferred from the instruction.'));

  // memory windows
  const memBox = h('div', 'vis-mem');
  const data = new Window(0, DATA_WORDS);
  const stack = new Window(STACK_BASE, STACK_WORDS);
  memBox.append(
    h('h3', 'vis-h', 'Data memory, words 0–63'), data.el,
    h('h3', 'vis-h', `Stack from ${hex(STACK_BASE, 5)}`), stack.el,
    h('p', 'caption dim', '80 of the 133,120 writable words are drawn; all of memory still exists and runs.'),
  );

  const off = h('div', 'empty vis-off');
  const main = h('div', 'vis-main');
  main.append(dpBox, memBox);
  el.append(bar, main, off);

  let fmt = FORMATS.signed;
  let pace: PaceName = 'slow';
  let program: object | null | undefined;
  let code: Uint32Array = new Uint32Array(0);
  let latest: Ctx | null = null;
  let lastT = -1;
  let stale = true;
  let animId = 0;

  const paceButtons = (['slow', 'normal', 'fast'] as const).map((p) => {
    const b = h('button', 'seg', p[0].toUpperCase() + p.slice(1));
    b.type = 'button';
    b.addEventListener('click', () => { pace = p; paint(); });
    paceBox.append(b);
    return { p, b };
  });
  const paint = (): void => paceButtons.forEach(({ p, b }) => b.setAttribute('aria-pressed', String(p === pace)));
  paint();

  fmtSelect.addEventListener('change', () => {
    fmt = FORMATS[fmtSelect.value as Format];
    diagram.setFormat(fmt);
    if (latest) settle(latest);
  });

  /** Show a state with no animation: registers, memory windows, the current instruction. */
  function settle(ctx: Ctx): void {
    const { vm, snap } = ctx;
    diagram.show(snap.regs, snap.pc);
    data.render(vm.memory(0, DATA_WORDS), fmt);
    stack.render(vm.memory(STACK_BASE, STACK_WORDS), fmt, snap.regs[14]);
    note.textContent = snap.pc < code.length
      ? `Next: ${mnemonic(decodeWord(code[snap.pc]))} at PC ${snap.pc}. Press Step to watch it run.`
      : `PC ${snap.pc} is outside the program.`;
  }

  function animate(ctx: Ctx): boolean {
    const { snap: cur, prev } = ctx;
    if (!prev) return false;
    const reversed = cur.t < prev.t || prev.direction === -1;
    const pc = reversed ? cur.pc : prev.pc;
    if (pc >= code.length) return false;
    const before = reversed ? cur.regs : prev.regs;
    const after = reversed ? prev.regs : cur.regs;
    const phases = buildScript({ word: code[pc], pc, pcAfter: reversed ? prev.pc : cur.pc, before, after });
    const id = ++animId;
    void diagram
      .play(phases, { reversed, pace: PACES[pace], before, after, pcBefore: pc, pcAfter: reversed ? prev.pc : cur.pc })
      .then(() => { if (id === animId && latest) settle(latest); });
    return true;
  }

  return {
    el,
    busy: () => diagram.busy,
    paces: (ctx) => ctx.view === 'visualisation' && !(ctx.run !== 'paused' && ctx.stepHz > ANIMATE_MAX_HZ) && learnVerdict(ctx.program).ok,
    update(ctx: Ctx) {
      latest = ctx;
      const verdict = learnVerdict(ctx.program);
      off.hidden = verdict.ok;
      main.hidden = !verdict.ok;
      bar.hidden = !verdict.ok;
      off.textContent = verdict.why;
      if (!verdict.ok) {
        program = undefined;
        return;
      }
      if (ctx.program !== program) {
        program = ctx.program;
        code = ctx.program!.codeLen > 0 ? ctx.vm.code(0, ctx.program!.codeLen) : new Uint32Array(0);
        diagram.clearUnits();
        lastT = -1;
        stale = true;
      }
      if (ctx.view !== 'visualisation') {
        stale = true;
        return;
      }
      const t = ctx.snap.t;
      const fast = ctx.run !== 'paused' && ctx.stepHz > ANIMATE_MAX_HZ;
      const step = !stale && !fast && lastT >= 0 && ctx.prev !== null && Math.abs(t - ctx.prev.t) === 1 && t !== lastT;
      lastT = t;
      stale = false;
      animId++;
      if (step && animate(ctx)) return;
      diagram.cancel();
      settle(ctx);
    },
  };
}
