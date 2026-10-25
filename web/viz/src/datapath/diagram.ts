/**
 * The datapath diagram: registers, incrementer, MAR, MBR, CIR, control unit, ALU, condition box, input
 * and output, joined by a bus. While an instruction executes, one sphere at a time travels along the wire it uses and
 * the wire fills in behind it, so it is clear which way the data goes. ILLUSTRATIVE (see script.ts).
 */
import { BOXES, BUS_X, VIEW, WIRES, lengthOf, pointAt, regTile, route, tagOffset } from './layout';
import type { Pt } from './layout';
import { PC_INDEX, regNode } from './script';
import type { Effect, Move, NodeId, Phase } from './script';

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

/** How fast the sphere travels: constant speed along the wire, so a long wire takes longer than a short one. */
export interface Pace {
  unitsPerSec: number;
  minMs: number;
  /** A pause after each phase so the new values can be read. */
  dwellMs: number;
}

export const PACES = {
  slow: { unitsPerSec: 190, minMs: 650, dwellMs: 700 },
  normal: { unitsPerSec: 320, minMs: 420, dwellMs: 450 },
  fast: { unitsPerSec: 700, minMs: 160, dwellMs: 160 },
} as const satisfies Record<string, Pace>;
export type PaceName = keyof typeof PACES;

export interface PlayOptions {
  reversed: boolean;
  pace: Pace;
  /** r0..r15 at the start and at the end of the forward run of the instruction, and the PC before and after. */
  before: ArrayLike<number>;
  after: ArrayLike<number>;
  pcBefore: number;
  pcAfter: number;
}

type TextNode = 'MAR' | 'MBR' | 'CIR' | 'CU' | 'ALU' | 'STATUS' | 'IN' | 'OUT';
const UNITS = ['INC', 'MAR', 'MBR', 'CIR', 'CU', 'STATUS', 'ALU', 'IN', 'OUT'] as const;
const TEXT_NODES: readonly string[] = ['MAR', 'MBR', 'CIR', 'CU', 'ALU', 'STATUS', 'IN', 'OUT'];
const TITLES: Record<string, string> = {
  INC: 'Incrementer', MAR: 'MAR', MBR: 'MBR', CIR: 'CIR', CU: 'Control unit', STATUS: 'Condition',
  ALU: 'Arithmetic and logic unit', IN: 'Input window', OUT: 'Output: screen',
};

const ease = (f: number): number => (f < 0.5 ? 4 * f * f * f : 1 - Math.pow(-2 * f + 2, 3) / 2);

export class Diagram {
  readonly el: SVGSVGElement;
  private readonly rects = new Map<NodeId, SVGRectElement>();
  private readonly regVals: SVGTextElement[] = [];
  private readonly texts = new Map<TextNode, SVGTextElement>();
  private readonly trace: SVGPolylineElement;
  private readonly sphere: SVGGElement;
  private readonly tag: SVGGElement;
  private readonly tagRect: SVGRectElement;
  private readonly tagText: SVGTextElement;
  private shown: number[] = new Array<number>(17).fill(0);
  private fmt: (v: number) => string = (v) => String(v | 0);
  private token = 0;
  private playing = false;

  constructor(private readonly hooks: DiagramHooks) {
    const svg = s('svg', { viewBox: `${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`, class: 'dp', role: 'img' });
    svg.setAttribute('aria-label', 'datapath diagram (illustrative)');
    this.el = svg;

    const defs = s('defs');
    const marker = s('marker', { id: 'dp-arrow', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 3.6, markerHeight: 3.6, orient: 'auto-start-reverse' });
    marker.append(s('path', { d: 'M0 0 L10 5 L0 10 z', class: 'dp-head' }));
    const grad = s('radialGradient', { id: 'dp-ball', cx: '35%', cy: '30%', r: '70%' });
    grad.append(s('stop', { offset: '0%', 'stop-color': '#ffffff', 'stop-opacity': 0.95 }), s('stop', { offset: '45%', class: 'dp-ball-mid' }), s('stop', { offset: '100%', class: 'dp-ball-edge' }));
    defs.append(marker, grad);
    svg.append(defs);

    // wires: the bus, then every wire data can travel
    const wires = s('g', { class: 'dp-wires' });
    wires.append(s('line', { x1: BUS_X, y1: 22, x2: BUS_X, y2: 463, class: 'dp-bus' }));
    for (const [a, b] of WIRES) {
      wires.append(s('polyline', { points: route(a, b).map((p) => `${p.x},${p.y}`).join(' '), class: 'dp-wire', 'marker-end': 'url(#dp-arrow)' }));
    }
    svg.append(wires);

    // registers
    const regs = s('g', { class: 'dp-regs' });
    regs.append(s('rect', { ...BOXES.regs, rx: 6, class: 'dp-box' }), s('text', { x: 10, y: 76, class: 'dp-title' }, 'Registers'));
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

    // the other units: a title and, for most, a value line
    for (const id of UNITS) {
      const b = BOXES[id];
      const rect = s('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 6, class: `dp-box dp-unit dp-${id.toLowerCase()}` });
      svg.append(rect);
      this.rects.set(id, rect);
      const oneRow = id === 'CIR';
      const small = b.w < 100;
      if (oneRow) {
        svg.append(s('text', { x: b.x + 12, y: b.y + (oneRow ? 20 : 17), class: 'dp-title' }, TITLES[id]));
      } else {
        svg.append(s('text', { x: b.x + b.w / 2, y: b.y + (small ? 14 : 18), class: 'dp-title', 'text-anchor': 'middle' }, TITLES[id]));
      }
      if (TEXT_NODES.includes(id)) {
        const attrs = oneRow
          ? { x: b.x + b.w - 12, y: b.y + 20, 'text-anchor': 'end' }
          : { x: b.x + b.w / 2, y: b.y + b.h - (small ? 5 : 8), 'text-anchor': 'middle' };
        const t = s('text', { ...attrs, class: 'dp-val dp-unit-val' }, '');
        svg.append(t);
        this.texts.set(id as TextNode, t);
      }
    }
    svg.append(s('text', { x: VIEW.w - 2, y: 84, class: 'dp-ext', 'text-anchor': 'end' }, 'Main memory'));

    // what is moving: the wire in use, then the sphere with the value it carries
    this.trace = s('polyline', { class: 'dp-trace', points: '' });
    this.sphere = s('g', { class: 'dp-sphere' });
    this.sphere.append(s('circle', { r: 13, class: 'dp-halo' }), s('circle', { r: 8.5, class: 'dp-core', fill: 'url(#dp-ball)' }));
    this.tag = s('g', { class: 'dp-tag' });
    this.tagRect = s('rect', { y: -11, height: 22, rx: 4 });
    this.tagText = s('text', { y: 5, 'text-anchor': 'middle' });
    this.tag.append(this.tagRect, this.tagText);
    this.sphere.append(this.tag);
    this.sphere.setAttribute('visibility', 'hidden');
    svg.append(this.trace, this.sphere);
  }

  /** True while an instruction is being played. The runner waits for it so a run never outpaces the picture. */
  get busy(): boolean {
    return this.playing;
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

  /** Clear the MAR / MBR / CIR / ALU texts (a new program). */
  clearUnits(): void {
    for (const t of this.texts.values()) t.textContent = '';
    this.texts.get('STATUS')!.textContent = '–';
  }

  cancel(): void {
    this.token++;
    this.playing = false;
    this.sphere.setAttribute('visibility', 'hidden');
    this.trace.setAttribute('points', '');
    this.light(new Set());
    delete this.el.dataset.dir;
  }

  /** Play one instruction. Resolves when it finishes or is cancelled; the caller then shows the final state. */
  async play(phases: readonly Phase[], o: PlayOptions): Promise<void> {
    this.cancel();
    const token = this.token;
    this.playing = true;
    this.el.dataset.dir = o.reversed ? 'back' : 'fwd';
    for (let i = 0; i < 16; i++) this.shown[i] = (o.reversed ? o.after[i] : o.before[i]) >>> 0;
    this.shown[PC_INDEX] = o.reversed ? o.pcAfter : o.pcBefore;
    this.paintRegs();

    const order = o.reversed ? [...phases].reverse() : phases;
    for (const ph of order) {
      if (token !== this.token) return;
      this.hooks.onNote(`${o.reversed ? 'Rewinding: ' : ''}${ph.note}`);
      const moves = o.reversed ? [...ph.moves].reverse() : ph.moves;
      if (moves.length === 0) this.light(new Set(ph.lit ?? []));
      for (const m of moves) {
        if (token !== this.token) return;
        this.light(new Set<NodeId>([m.from, m.to]));
        await this.travel(m, o.reversed, o.pace, token);
      }
      if (token !== this.token) return;
      for (const e of o.reversed ? [...ph.effects].reverse() : ph.effects) this.apply(e, o.reversed);
      await this.animate(o.pace.dwellMs, token, () => {});
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

  /** One sphere along one wire: constant speed, the wire filling in behind it. */
  private async travel(m: Move, reversed: boolean, pace: Pace, token: number): Promise<void> {
    // backwards in time: the same wire, travelled the other way
    const pts: Pt[] = reversed ? [...route(m.from, m.to)].reverse() : route(m.from, m.to);
    const len = lengthOf(pts);
    const ms = Math.max(pace.minMs, (len / pace.unitsPerSec) * 1000);
    this.trace.setAttribute('points', pts.map((p) => `${p.x},${p.y}`).join(' '));
    this.trace.setAttribute('stroke-dasharray', String(len + 1));
    this.trace.setAttribute('stroke-dashoffset', String(len + 1));
    const w = Math.max(30, m.label.length * 8.6 + 14);
    this.tagRect.setAttribute('x', String(-w / 2));
    this.tagRect.setAttribute('width', String(w));
    this.tagText.textContent = m.label;
    this.sphere.setAttribute('visibility', 'visible');
    await this.animate(ms, token, (f) => {
      const k = ease(f);
      const p = pointAt(pts, k);
      this.sphere.setAttribute('transform', `translate(${p.x} ${p.y})`);
      // the value rides above the sphere; near the right edge it moves in so it is not cut off
      const tx = Math.min(Math.max(p.x, w / 2 + 2), VIEW.w - w / 2 - 2) - p.x;
      this.tag.setAttribute('transform', `translate(${tx} ${tagOffset(p.y)})`);
      this.trace.setAttribute('stroke-dashoffset', String((len + 1) * (1 - k)));
    });
  }

  private animate(ms: number, token: number, frame: (f: number) => void): Promise<void> {
    const start = performance.now();
    return new Promise((resolve) => {
      const tick = (): void => {
        if (token !== this.token) return resolve();
        const f = ms <= 0 ? 1 : Math.min(1, (performance.now() - start) / ms); // one clock: rAF timestamps can differ
        frame(f);
        if (f >= 1) resolve();
        else requestAnimationFrame(tick);
      };
      frame(0);
      requestAnimationFrame(tick);
    });
  }
}
