import { Diagram, PACES } from '../datapath/diagram';
import { buildScript, decodeWord, mnemonic } from '../datapath/script';
import { h } from '../dom';
import { learnVerdict } from '../program';
import { mainMemory } from './mainmemory';
import type { Ctx, Panel } from './panel';

/** Above this many steps per second a run is too fast to follow: the picture jumps instead of animating. */
const ANIMATE_MAX_HZ = 20;

export type VisualisePanel = Panel & {
  /** True while an instruction is being animated: a run waits for it. */
  busy(): boolean;
  /** Whether the animation is on screen and slow enough to pace a run. */
  paces(ctx: Ctx): boolean;
};

/**
 * The Visualisation tab: the datapath with a sphere that travels along each wire, and one main memory (program, data and
 * stack) beside it. All of the machine's memory and registers still exist and run; only the program, 64 data words and 16
 * stack words are drawn. Only for simple programs (see learnVerdict). The animation speed comes from the debug bar.
 */
export function visualisePanel(inputBar?: HTMLElement): VisualisePanel {
  const el = h('div', 'vis');

  const note = h('div', 'vis-note');
  // the note changes at every phase of an animation: screen readers get the settled state only, from a separate region
  const announce = h('div', 'sr-only');
  announce.setAttribute('role', 'status');

  const memory = mainMemory();
  const diagram = new Diagram({
    onNote: (t) => { note.textContent = t; },
    onCode: (addr) => memory.touchProgram(addr),
    onMem: (addr, mode) => memory.touchData(addr, mode),
  });
  const dpBox = h('div', 'vis-dp');
  dpBox.append(diagram.el, h('p', 'vis-caption dim', 'A picture, not a trace: the VM does not report datapath moves, so each one is worked out from the instruction.'));

  const main = h('div', 'vis-main');
  main.append(dpBox, memory.el);
  const off = h('div', 'empty vis-off');
  if (inputBar) el.append(note, announce, inputBar, main, off);
  else el.append(note, announce, main, off);

  let program: object | null | undefined;
  let code: Uint32Array = new Uint32Array(0);
  let latest: Ctx | null = null;
  let lastT = -1;
  let stale = true;
  let animId = 0;

  /** Show a state with no animation: registers, memory, the current instruction. */
  function settle(ctx: Ctx): void {
    const { vm, snap } = ctx;
    diagram.show(snap.regs, snap.pc);
    memory.render(vm, snap.pc, snap.regs[14]);
    memory.followPc(snap.pc);
    note.textContent = snap.pc < code.length
      ? `Next: ${mnemonic(decodeWord(code[snap.pc]))} at P${snap.pc}. Press Step to watch it run.`
      : `PC ${snap.pc} is outside the program.`;
    announce.textContent = note.textContent;
  }

  function animate(ctx: Ctx): boolean {
    const { snap: cur, prev } = ctx;
    if (!prev) return false;
    // reduced motion: no travelling sphere. The state is shown at once, and the note still says what the instruction did.
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    const reversed = cur.t < prev.t || prev.direction === -1;
    const pc = reversed ? cur.pc : prev.pc;
    if (pc >= code.length) return false;
    const before = reversed ? cur.regs : prev.regs;
    const after = reversed ? prev.regs : cur.regs;
    const phases = buildScript({ word: code[pc], pc, pcAfter: reversed ? prev.pc : cur.pc, before, after });
    const id = ++animId;
    // the memory shows the state before the instruction while it plays, then settles on the result
    memory.render(ctx.vm, pc, cur.regs[14]);
    void diagram
      .play(phases, { reversed, pace: PACES[ctx.pace === 'instant' ? 'fast' : ctx.pace], before, after, pcBefore: pc, pcAfter: reversed ? prev.pc : cur.pc })
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
      note.hidden = !verdict.ok;
      if (inputBar) inputBar.hidden = !verdict.ok;
      off.textContent = verdict.why;
      if (!verdict.ok) {
        program = undefined;
        return;
      }
      if (ctx.program !== program) {
        program = ctx.program;
        code = ctx.program!.codeLen > 0 ? ctx.vm.code(0, ctx.program!.codeLen) : new Uint32Array(0);
        memory.setProgram(code);
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

