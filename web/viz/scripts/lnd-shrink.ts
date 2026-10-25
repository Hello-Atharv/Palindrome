// Finds a random failing session on pong.rev (no direction flips) and shrinks it to the fewest operations that still fail.
import { compile } from '../../../lang/src/compile';
import pongRev from '../../../examples/demos/pong.rev?raw';
import type { RVM, VmKind } from '../../../spec/vm_api';
import { createWasmVm } from '../../wasm/src/index';

const image = compile(pongRev).image!;
type Op = { k: 'fwd'; n: number } | { k: 'key'; code: number } | { k: 'back'; n: number } | { k: 'scrub'; t: number };
const KEYS = [0x57, 0x53, 0x80, 0x81, 0x157, 0x153, 0x180, 0x181];
let seed = Number(process.argv[2] ?? 7);
const rnd = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];

async function replay(kind: VmKind, ops: Op[]): Promise<string | null> {
  const v: RVM = await createWasmVm(kind);
  v.loadProgram(image);
  let maxT = 0;
  for (const op of ops) {
    if (op.k === 'fwd') { for (let i = 0; i < op.n; i++) { const s = v.stepForward(); if (s === 'fault') return v.lastError; if (s !== 'ok') break; } maxT = Math.max(maxT, v.instructionCount); }
    else if (op.k === 'key') { v.pushInput(op.code); maxT = v.instructionCount; }
    else if (op.k === 'back') { for (let i = 0; i < op.n; i++) { const s = v.stepBack(); if (s === 'fault') return v.lastError; if (s !== 'ok') break; } }
    else { const s = v.runTo(Math.min(op.t, maxT)); if (s === 'fault') return v.lastError; }
  }
  return null;
}
const describe = (ops: Op[]): string => ops.map((o) => o.k === 'fwd' ? `run forward ${o.n} steps` : o.k === 'key' ? `key 0x${o.code.toString(16)}` : o.k === 'back' ? `step back ${o.n}` : `scrub to t=${o.t}`).join(' -> ');

for (const kind of ['logging', 'reversible'] as const) {
  let found: { ops: Op[]; err: string } | null = null;
  for (let trial = 0; trial < 400 && !found; trial++) {
    const ops: Op[] = [];
    for (let i = 0; i < 14; i++) {
      const r = rnd();
      ops.push(r < 0.35 ? { k: 'fwd', n: pick([5, 50, 500, 3000]) } : r < 0.65 ? { k: 'key', code: pick(KEYS) } : r < 0.85 ? { k: 'back', n: pick([1, 7, 100]) } : { k: 'scrub', t: Math.floor(rnd() * 6000) });
    }
    const err = await replay(kind, ops);
    if (err) found = { ops, err };
  }
  if (!found) { console.log(`${kind}: no failure found`); continue; }
  let ops = found.ops;
  for (let changed = true; changed; ) { // drop one op at a time while it still fails
    changed = false;
    for (let i = 0; i < ops.length; i++) {
      const cand = ops.filter((_, j) => j !== i);
      if (await replay(kind, cand)) { ops = cand; changed = true; break; }
    }
  }
  // shrink the numbers too
  for (const op of ops) {
    if (op.k === 'fwd' || op.k === 'back') for (const n of [1, 2, 3, 5, 7, 10, 20, 50, 100, 200, 500, 1000]) { if (n >= op.n) break; const old = op.n; op.n = n; if (await replay(kind, ops)) break; op.n = old; }
  }
  console.log(`${kind}: "${found.err}"\n  minimal: ${describe(ops)}\n  (${ops.length} operations)`);
}
