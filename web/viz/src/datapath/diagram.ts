/**
 * The datapath diagram: registers, incrementer, MAR, MBR, CIR, control unit, ALU, condition box, input and output,
 * joined by a bus. Packets carry values along the wires while an instruction executes. ILLUSTRATIVE (see script.ts).
 */
import { BOXES, BUS_X, VIEW, WIRES, pointAt, regTile, route } from './layout';
import type { Pt } from './layout';
import { PC_INDEX, regNode } from './script';
import type { Effect, NodeId, Phase } from './script';

const NS = 'http://www.w3.org/2000/svg';

function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, text?: string): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
}

export interface DiagramHooks {
  onNote(text: string): void;
  onCode(addr: number): void;
  onMem(addr: number, mode: 'read' | 'write'): void;
}

export interface PlayOptions {
  reversed: boolean;
  phaseMs: number;
  /** r0..r15 and the PC at the start of the forward run of the instruction, and at its end. */
  before: ArrayLike<number>;
  after: ArrayLike<number>;
  pcBefore: number;
  pcAfter: number;
}

type TextNode = 'MAR' | 'MBR' | 'CIR' | 'CU' | 'ALU' | 'STATUS' | 'IN' | 'OUT';
const TEXT_NODES: TextNode[] = ['MAR', 'MBR', 'CIR', 'CU', 'ALU', 'STATUS', 'IN', 'OUT'];
const TITLES: Record<string, string> = {
  INC: 'Incrementer', MAR: 'MAR', MBR: 'MBR', CIR: 'CIR', CU: 'Control Unit', STATUS: 'Condition',
  ALU: 'Arithmetic and Logic Unit', IN: 'Input window', OUT: 'Output: screen',
};

export class Diagram {
  readonly el: SVGSVGElement;
  private readonly rects = new Map<NodeId, SVGRectElement>();
  private readonly regVals: SVGTextElement[] = [];
  private readonly texts = new Map<TextNode, SVGTextElement>();
  private readonly packets: SVGGElement;
  private shown: number[] = new Array<number>(17).fill(0);
  private fmt: (v: number) => string = (v) => String(v | 0);
  private token = 0;

  constructor(private readonly hooks: DiagramHooks) {
    const svg = s('svg', { viewBox: `${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`, class: 'dp', role: 'img' });
    svg.setAttribute('aria-label', 'datapath diagram (illustrative)');
    this.el = svg;

    const defs = s('defs');
    const marker = s('marker', { id: 'dp-arrow', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' });
    marker.append(s('path', { d: 'M0 0 L10 5 L0 10 z', class: 'dp-head' }));
    defs.append(marker);
    svg.append(defs);

    // wires: the bus, then every wire a packet can travel
    const wires = s('g', { class: 'dp-wires' });
    wires.append(s('line', { x1: BUS_X, y1: 37, x2: BUS_X, y2: 430, class: 'dp-bus' }));
    for (const [a, b] of WIRES) {
      const pts = route(a, b);
      wires.append(s('polyline', { points: pts.map((p) => `${p.x},${p.y}`).join(' '), class: 'dp-wire', 'marker-end': 'url(#dp-arrow)' }));
    }
    svg.append(wires);

    // registers
    const regs = s('g', { class: 'dp-regs' });
    regs.append(s('rect', { ...BOXES.regs, rx: 6, class: 'dp-box' }), s('text', { x: 10, y: 16, class: 'dp-title' }, 'Registers'));
    for (let i = 0; i <= PC_INDEX; i++) {
      const t = regTile(i);
      const rect = s('rect', { x: t.x, y: t.y, width: t.w, height: t.h, rx: 4, class: 'dp-tile' });
      const name = s('text', { x: t.x + 6, y: t.y + 15, class: 'dp-name' }, i === PC_INDEX ? 'PC' : i === 14 ? 'sp' : `r${i}`);
      const val = s('text', { x: t.x + t.w - 6, y: t.y + 15, class: 'dp-val', 'text-anchor': 'end' }, '0');
      regs.append(rect, name, val);
      this.rects.set(i === PC_INDEX ? 'PC' : regNode(i), rect);
      this.regVals[i] = val;
    }
    svg.append(regs);

    // boxes with a title and a value line
    for (const id of ['INC', 'MAR', 'MBR', 'CIR', 'CU', 'STATUS', 'ALU', 'IN', 'OUT'] as const) {
      const b = BOXES[id];
      const rect = s('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 6, class: `dp-box dp-unit dp-${id.toLowerCase()}` });
      const small = b.w < 100;
      // the CIR is one row: its name on the left, the instruction word on the right
      const oneRow = id === 'CIR';
      const title = oneRow
        ? s('text', { x: b.x + 12, y: b.y + 20, class: 'dp-title' }, TITLES[id])
        : s('text', { x: b.x + b.w / 2, y: b.y + (small ? 14 : 18), class: 'dp-title', 'text-anchor': 'middle' }, TITLES[id]);
      svg.append(rect, title);
      this.rects.set(id, rect);
      if ((TEXT_NODES as string[]).includes(id)) {
        const t = oneRow
          ? s('text', { x: b.x + b.w - 12, y: b.y + 20, class: 'dp-val dp-unit-val', 'text-anchor': 'end' }, '')
          : s('text', { x: b.x + b.w / 2, y: b.y + b.h - (small ? 5 : 8), class: 'dp-val dp-unit-val', 'text-anchor': 'middle' }, '');
        svg.append(t);
        this.texts.set(id as TextNode, t);
      }
    }
    this.addExternalLabel(svg, 'code', -28, 30);
    this.addExternalLabel(svg, 'data memory', 556, 84, 'end');

    this.packets = s('g', { class: 'dp-packets' });
    svg.append(this.packets);
  }

  private addExternalLabel(svg: SVGSVGElement, text: string, x: number, y: number, anchor = 'start'): void {
    svg.append(s('text', { x, y, class: 'dp-ext', 'text-anchor': anchor }, text));
  }

  /** How register values are written (signed, unsigned, hex). */
  setFormat(fn: (v: number) => string): void {
    this.fmt = fn;
    this.paintRegs();
  }

  private paintRegs(): void {
    this.shown.forEach((v, i) => { if (this.regVals[i]) this.regVals[i].textContent = this.fmt(v); });
  }

  /** The display of a state, with no animation. */
  show(regs: ArrayLike<number>, pc: number): void {
    this.cancel();
    for (let i = 0; i < 16; i++) this.shown[i] = regs[i] >>> 0;
    this.shown[PC_INDEX] = pc;
    this.paintRegs();
  }

  /** Clear the CIR/MAR/MBR/ALU/... texts (a new program, or after a jump in time). */
  clearUnits(): void {
    for (const t of this.texts.values()) t.textContent = '';
    this.texts.get('STATUS')!.textContent = '–';
  }

  cancel(): void {
    this.token++;
    this.packets.replaceChildren();
    this.light(new Set());
    delete this.el.dataset.dir;
  }

  /** Play one instruction. Resolves when it finishes or is cancelled; the caller then shows the final state. */
  async play(phases: readonly Phase[], o: PlayOptions): Promise<void> {
    this.cancel();
    const token = this.token;
    this.el.dataset.dir = o.reversed ? 'back' : 'fwd';
    for (let i = 0; i < 16; i++) this.shown[i] = (o.reversed ? o.after[i] : o.before[i]) >>> 0;
    this.shown[PC_INDEX] = o.reversed ? o.pcAfter : o.pcBefore;
    this.paintRegs();

    const order = o.reversed ? [...phases].reverse() : phases;
    for (const ph of order) {
      if (token !== this.token) return;
      this.hooks.onNote(`${o.reversed ? 'Rewinding: ' : ''}${ph.note}`);
      const lit = new Set<NodeId>(ph.lit ?? []);
      for (const m of ph.moves) { lit.add(m.from); lit.add(m.to); }
      this.light(lit);
      await this.tween(ph, o.reversed, o.phaseMs, token);
      if (token !== this.token) return;
      const effects = o.reversed ? [...ph.effects].reverse() : ph.effects;
      for (const e of effects) this.apply(e, o.reversed);
    }
    if (token === this.token) this.cancel();
  }

  private apply(e: Effect, reversed: boolean): void {
    if (e.kind === 'text') {
      this.texts.get(e.node)!.textContent = e.text;
    } else if (e.kind === 'reg') {
      this.shown[e.index] = (reversed ? e.before : e.after) >>> 0;
      this.paintRegs();
    } else if (e.kind === 'code') {
      this.hooks.onCode(e.addr);
    } else {
      this.hooks.onMem(e.addr, e.mode);
    }
  }

  private light(nodes: Set<NodeId>): void {
    for (const [id, rect] of this.rects) rect.classList.toggle('dp-lit', nodes.has(id));
  }

  private tween(ph: Phase, reversed: boolean, ms: number, token: number): Promise<void> {
    this.packets.replaceChildren();
    if (ph.moves.length === 0) return wait(ms * 0.6);
    const items = ph.moves.map((m) => {
      // backwards in time: the same wire, travelled the other way
      const pts = reversed ? [...route(m.from, m.to)].reverse() : route(m.from, m.to);
      const g = s('g', { class: 'dp-packet' });
      const w = Math.max(24, m.label.length * 8.4 + 12);
      const rect = s('rect', { x: -w / 2, y: -11, width: w, height: 22, rx: 11 });
      const text = s('text', { x: 0, y: 5, 'text-anchor': 'middle' }, m.label);
      g.append(rect, text);
      this.packets.append(g);
      const p0 = pointAt(pts, 0); // start in place: no frame at the origin before the first tick
      g.setAttribute('transform', `translate(${p0.x} ${p0.y})`);
      return { g, pts };
    });
    const start = performance.now();
    return new Promise((resolve) => {
      const frame = (): void => {
        if (token !== this.token) return resolve();
        const f = ms <= 0 ? 1 : Math.min(1, (performance.now() - start) / ms); // one clock: rAF timestamps can differ
        for (const { g, pts } of items) {
          const p: Pt = pointAt(pts, f);
          g.setAttribute('transform', `translate(${p.x} ${p.y})`);
        }
        if (f >= 1) resolve();
        else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  }
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
