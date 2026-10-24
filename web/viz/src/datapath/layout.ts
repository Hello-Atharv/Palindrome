/**
 * Geometry of the datapath diagram (SVG user units) and the routing of data along the bus.
 * Left of the bus: program memory, the registers and the control side. Right of the bus: the units that talk to
 * data memory (which the page draws beside the diagram).
 */
import type { NodeId } from './script';
import { PC_INDEX } from './script';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Pt {
  x: number;
  y: number;
}

export const VIEW = { x: 0, y: 0, w: 566, h: 486 };
export const BUS_X = 292;

export const BOXES = {
  CODE: { x: 0, y: 0, w: 250, h: 44 },
  regs: { x: 0, y: 58, w: 250, h: 242 },
  INC: { x: 330, y: 6, w: 130, h: 30 },
  MAR: { x: 330, y: 90, w: 84, h: 34 },
  MBR: { x: 330, y: 150, w: 84, h: 34 },
  CIR: { x: 0, y: 316, w: 200, h: 30 },
  CU: { x: 0, y: 360, w: 200, h: 74 },
  STATUS: { x: 206, y: 376, w: 80, h: 52 },
  ALU: { x: 330, y: 300, w: 220, h: 80 },
  IN: { x: 0, y: 448, w: 150, h: 30 },
  OUT: { x: 330, y: 396, w: 220, h: 52 },
} as const;

/** Register tile i (0..15), or the PC tile (16). */
export function regTile(index: number): Box {
  if (index === PC_INDEX) return { x: 8, y: 82, w: 234, h: 26 };
  return { x: 8 + (index % 2) * 122, y: 114 + Math.floor(index / 2) * 22, w: 118, h: 20 };
}

const mid = (b: Box): number => b.y + b.h / 2;
const P = (x: number, y: number): Pt => ({ x, y });

/** Where data enters or leaves a node on its way to or from the bus. */
export function busAnchor(n: NodeId): Pt {
  if (n === 'PC') return P(250, mid(regTile(PC_INDEX)));
  if (n.startsWith('R')) return P(250, mid(regTile(Number(n.slice(1)))));
  switch (n) {
    case 'CODE': return P(BOXES.CODE.x + BOXES.CODE.w, mid(BOXES.CODE));
    case 'INC': return P(BOXES.INC.x, mid(BOXES.INC));
    case 'MAR': return P(BOXES.MAR.x, mid(BOXES.MAR));
    case 'MBR': return P(BOXES.MBR.x, mid(BOXES.MBR));
    case 'CIR': return P(BOXES.CIR.x + BOXES.CIR.w, mid(BOXES.CIR));
    case 'ALU': return P(BOXES.ALU.x, 340);
    case 'STATUS': return P(BOXES.STATUS.x + BOXES.STATUS.w, mid(BOXES.STATUS));
    case 'IN': return P(BOXES.IN.x + BOXES.IN.w, mid(BOXES.IN));
    case 'OUT': return P(BOXES.OUT.x, 423);
    case 'CU': return P(BOXES.CU.x + BOXES.CU.w, mid(BOXES.CU));
    default: return P(BUS_X, 220);
  }
}

/** Wires that do not go through the bus. */
const DIRECT: Record<string, Pt[]> = {
  'CIR>CU': [P(100, 346), P(100, 360)],
  'MAR>MEM': [P(414, 107), P(566, 107)],
  'MBR>MEM': [P(414, 167), P(566, 167)],
  'MEM>MBR': [P(566, 167), P(414, 167)],
};

/** The polyline data follows from one node to another. */
export function route(from: NodeId, to: NodeId): Pt[] {
  const direct = DIRECT[`${from}>${to}`];
  if (direct) return direct;
  const a = busAnchor(from), b = busAnchor(to);
  return dedupe([a, P(BUS_X, a.y), P(BUS_X, b.y), b]);
}

function dedupe(pts: Pt[]): Pt[] {
  return pts.filter((p, i) => i === 0 || p.x !== pts[i - 1].x || p.y !== pts[i - 1].y);
}

export function lengthOf(pts: readonly Pt[]): number {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return total;
}

/** Point a fraction `f` (0..1) of the way along a polyline, by length. */
export function pointAt(pts: readonly Pt[], f: number): Pt {
  const total = lengthOf(pts);
  if (total === 0) return pts[0];
  let left = Math.min(Math.max(f, 0), 1) * total;
  for (let i = 1; i < pts.length; i++) {
    const len = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (left <= len) {
      const k = len === 0 ? 0 : left / len;
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * k, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * k };
    }
    left -= len;
  }
  return pts[pts.length - 1];
}

/** The wires drawn in the idle diagram (each is also a route data can travel). */
export const WIRES: [NodeId, NodeId][] = [
  ['PC', 'CODE'], ['CODE', 'CIR'], ['CIR', 'CU'], ['PC', 'INC'], ['INC', 'PC'],
  ['MAR', 'MEM'], ['MBR', 'MEM'], ['MEM', 'MBR'], ['ALU', 'MAR'], ['CIR', 'ALU'], ['CIR', 'PC'], ['ALU', 'STATUS'],
  ['R0', 'ALU'], ['ALU', 'R0'], ['MBR', 'ALU'], ['IN', 'MBR'], ['MBR', 'OUT'],
];
