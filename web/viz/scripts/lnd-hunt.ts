// Hunts for "LND assertion failed" on Pong: random key presses, step backs, scrubs and direction flips on both real engines.
//   npx vite-node scripts/lnd-hunt.ts [trials]
import { assemble } from '../../../asm/src/index';
import { compile } from '../../../lang/src/compile';
import pongS from '../../../examples/demos/pong.s?raw';
import pongRev from '../../../examples/demos/pong.rev?raw';
import type { RVM, VmKind } from '../../../spec/vm_api';
import { createWasmVm } from '../../wasm/src/index';

const trials = Number(process.argv[2] ?? 60);
const PROGRAMS: Record<string, Uint8Array> = {
  'pong.s': assemble(pongS).image!,
  'pong.rev': compile(pongRev).image!,
};
const KEYS = [0x57, 0x53, 0x80, 0x81]; // W S up down

let seed = 12345;
const rnd = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];

interface Hit { program: string; engine: string; log: string[]; err: string; t: number; dir: number }
const hits: Hit[] = [];

async function trial(program: string, kind: VmKind, compareKinds?: VmKind[]): Promise<void> {
  const vms: RVM[] = [];
  for (const k of compareKinds ?? [kind]) {
    const v = await createWasmVm(k);
    v.loadProgram(PROGRAMS[program]);
    vms.push(v);
  }
  const log: string[] = [];
  let maxT = 0;
  const all = (f: (v: RVM) => string): string[] => vms.map(f);
  const bad = (what: string, ss: string[]): boolean => {
    log.push(what);
    const i = ss.findIndex((s) => s === 'fault');
    if (i < 0) return false;
    hits.push({ program, engine: compareKinds ? `compare(${compareKinds})/${compareKinds[i]}` : kind, log: [...log], err: vms[i].lastError, t: vms[i].instructionCount, dir: vms[i].direction });
    return true;
  };
  for (let op = 0; op < 40; op++) {
    const r = rnd();
    if (r < 0.35) { // run forward some steps (maybe to the end of the game)
      const n = pick([5, 50, 500, 5000, 100000]);
      for (let i = 0; i < n; i++) {
        const ss = all((v) => v.stepForward());
        if (ss[0] !== 'ok') { if (bad(`run forward ${n} steps -> ${ss[0]} at t=${vms[0].instructionCount}`, ss)) return; break; }
      }
      log.push(`(ran forward up to ${n}, t=${vms[0].instructionCount})`);
      maxT = Math.max(maxT, vms[0].instructionCount);
    } else if (r < 0.6) { // press or release a key at the current t
      const code = pick(KEYS) | (rnd() < 0.5 ? 0x100 : 0);
      all((v) => v.pushInput(code));
      log.push(`key 0x${code.toString(16)} at t=${vms[0].instructionCount}${vms[0].instructionCount < maxT ? ' (after going back: new timeline)' : ''}`);
      maxT = vms[0].instructionCount;
    } else if (r < 0.8) { // step back
      const n = pick([1, 7, 100, 3000]);
      let s = 'ok';
      for (let i = 0; i < n && s === 'ok'; i++) { const ss = all((v) => v.stepBack()); s = ss[0]; if (bad(`step back ${n}`, ss)) return; }
    } else if (r < 0.95) { // scrub
      const t = Math.floor(rnd() * (maxT + 1));
      const ss = all((v) => v.runTo(t));
      if (bad(`scrub to t=${t}`, ss)) return;
    } else if (process.env.NOFLIP) { /* no flips */ } else { // direction flip
      const d = vms[0].direction === 1 ? -1 : 1;
      all((v) => v.setDirection(d));
      log.push(`direction ${d} at t=${vms[0].instructionCount}`);
      maxT = vms[0].instructionCount;
    }
  }
  vms.forEach((v) => (v as { destroy?: () => void }).destroy?.());
}

for (const program of Object.keys(PROGRAMS)) {
  for (const [name, kind, cmp] of [['logging', 'logging', undefined], ['reversible', 'reversible', undefined], ['compare', 'logging', ['logging', 'reversible'] as VmKind[]]] as const) {
    const before = hits.length;
    for (let i = 0; i < trials; i++) await trial(program, kind, cmp);
    console.log(`${program} / ${name}: ${trials} random sessions, ${hits.length - before} LND-style faults`);
  }
}
const tally = new Map<string, number>();
for (const h of hits) tally.set(`${h.program} ${h.engine} dir ${h.dir}: ${h.err}`, (tally.get(`${h.program} ${h.engine} dir ${h.dir}: ${h.err}`) ?? 0) + 1);
console.log([...tally].map(([k, v]) => `  ${v}x ${k}`).join('\n'));
for (const h of hits.filter((x) => x.dir === 1 || /LND/i.test(x.err)).slice(0, 5)) {
  console.log(`\n${h.program} on ${h.engine}: "${h.err}" at t=${h.t}, direction ${h.dir}\n  ` + h.log.slice(-8).join('\n  '));
}
