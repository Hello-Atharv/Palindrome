/**
 * Geometry of the datapath diagram (SVG user units) and the routing of packets along the bus.
 * Left of the bus: the registers and the control side. Right of the bus: the units that talk to memory.
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

/** The viewBox: it starts left of 0 so the "program memory" stubs can leave to the listing beside the diagram. */
export const VIEW = { x: -30, y: 0, w: 590, h: 456 };
export const BUS_X = 292;

export const BOXES = {
  regs: { x: 0, y: 0, w: 250, h: 242 },
  INC: { x: 330, y: 6, w: 130, h: 30 },
  MAR: { x: 330, y: 90, w: 84, h: 34 },
  MBR: { x: 330, y: 150, w: 84, h: 34 },
  CIR: { x: 0, y: 262, w: 200, h: 30 },
  CU: { x: 0, y: 310, w: 200, h: 74 },
  STATUS: { x: 206, y: 326, w: 80, h: 52 },
  ALU: { x: 330, y: 300, w: 220, h: 80 },
  IN: { x: 0, y: 414, w: 150, h: 30 },
  OUT: { x: 330, y: 396, w: 220, h: 52 },
} as const;

/** Register tile i (0..15), or the PC tile (16). */
export function regTile(index: number): Box {
  if (index === PC_INDEX) return { x: 8, y: 24, w: 234, h: 26 };
  return { x: 8 + (index % 2) * 122, y: 56 + Math.floor(index / 2) * 22, w: 118, h: 20 };
}

const mid = (b: Box): number => b.y + b.h / 2;

/** Where a packet enters or leaves a node on its way to or from the bus. */
export function busAnchor(n: NodeId): Pt {
  if (n === 'PC') return { x: 250, y: mid(regTile(PC_INDEX)) };
  if (n.startsWith('R')) return { x: 250, y: mid(regTile(Number(n.slice(1)))) };
  switch (n) {
    case 'INC': return { x: BOXES.INC.x, y: mid(BOXES.INC) };
    case 'MAR': return { x: BOXES.MAR.x, y: mid(BOXES.MAR) };
    case 'MBR': return { x: BOXES.MBR.x, y: mid(BOXES.MBR) };
    case 'CIR': return { x: BOXES.CIR.x + BOXES.CIR.w, y: mid(BOXES.CIR) };
    case 'ALU': return { x: BOXES.ALU.x, y: 340 };
    case 'STATUS': return { x: BOXES.STATUS.x + BOXES.STATUS.w, y: mid(BOXES.STATUS) };
    case 'IN': return { x: BOXES.IN.x + BOXES.IN.w, y: mid(BOXES.IN) };
    case 'OUT': return { x: BOXES.OUT.x, y: 423 };
    case 'CU': return { x: BOXES.CU.x + BOXES.CU.w, y: mid(BOXES.CU) };
    default: return { x: BUS_X, y: 220 };
  }
}

const P = (x: number, y: number): Pt => ({ x, y });

/** Wires that do not go through the bus. */
const DIRECT: Record<string, Pt[]> = {
  'PC>CODE': [P(8, 37), P(-30, 37)],
  'CODE>CIR': [P(-30, 277), P(0, 277)],
  'CIR>CU': [P(100, 292), P(100, 310)],
  'MAR>MEM': [P(414, 107), P(560, 107)],
  'MBR>MEM': [P(414, 167), P(560, 167)],
  'MEM>MBR': [P(560, 167), P(414, 167)],
};

/** The polyline a packet follows from one node to another. */
export function route(from: NodeId, to: NodeId): Pt[] {
  const direct = DIRECT[`${from}>${to}`];
  if (direct) return direct;
  const a = busAnchor(from), b = busAnchor(to);
  return dedupe([a, P(BUS_X, a.y), P(BUS_X, b.y), b]);
}

function dedupe(pts: Pt[]): Pt[] {
  return pts.filter((p, i) => i === 0 || p.x !== pts[i - 1].x || p.y !== pts[i - 1].y);
}

/** Point a fraction `f` (0..1) of the way along a polyline, by length. */
export function pointAt(pts: readonly Pt[], f: number): Pt {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
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

/** The wires drawn in the idle diagram (each is also a path packets can travel). */
export const WIRES: [NodeId, NodeId][] = [
  ['PC', 'CODE'], ['CODE', 'CIR'], ['CIR', 'CU'], ['PC', 'INC'], ['INC', 'PC'],
  ['MAR', 'MEM'], ['MBR', 'MEM'], ['MEM', 'MBR'], ['ALU', 'MAR'], ['CIR', 'ALU'], ['CIR', 'PC'], ['ALU', 'STATUS'],
  ['R0', 'ALU'], ['ALU', 'R0'], ['MBR', 'ALU'], ['IN', 'MBR'], ['MBR', 'OUT'],
];
