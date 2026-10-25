import { compile } from '../../../lang/src/compile';
import pongRev from '../../../examples/demos/pong.rev?raw';
import type { RVM, VmKind } from '../../../spec/vm_api';
import { createWasmVm } from '../../wasm/src/index';

const image = compile(pongRev).image!;
async function run(kind: VmKind, o: { first?: number; back: number; mid: number; second?: number; tail: number; atFirst?: number }): Promise<string> {
  const v: RVM = await createWasmVm(kind);
  v.loadProgram(image);
  const fwd = (n: number): string => { for (let i = 0; i < n; i++) { const s = v.stepForward(); if (s !== 'ok') return s; } return 'ok'; };
  if (o.first !== undefined) { fwd(o.atFirst ?? 0); v.pushInput(o.first); }
  fwd(50);
  for (let i = 0; i < o.back; i++) v.stepBack();
  let s = fwd(o.mid);
  if (s === 'ok' && o.second !== undefined) { v.pushInput(o.second); }
  if (s === 'ok') s = fwd(o.tail);
  return s === 'fault' ? `FAULT "${v.lastError}" at t=${v.instructionCount}` : 'ok';
}
const base = { first: 0x80, back: 2, mid: 3051, second: 0x181, tail: 50 };
const cases: [string, Partial<typeof base> & { atFirst?: number }][] = [
  ['the minimal recipe', {}],
  ['without the first key', { first: undefined }],
  ['without stepping back', { back: 0 }],
  ['step back 1', { back: 1 }],
  ['step back 3', { back: 3 }],
  ['step back 10', { back: 10 }],
  ['without the second key', { second: undefined }],
  ['second key is W press (0x57)', { second: 0x57 }],
  ['second key is a release of Up (0x180)', { second: 0x180 }],
  ['first key is W press', { first: 0x57 }],
  ['run 2000 instead of 3051 between', { mid: 2000 }],
  ['run 3000 instead of 3051 between', { mid: 3000 }],
  ['run 4000 between', { mid: 4000 }],
];
for (const kind of ['logging', 'reversible'] as const) {
  console.log(`--- ${kind}`);
  for (const [label, o] of cases) console.log(`${(await run(kind, { ...base, ...o } as never)).padEnd(40)} ${label}`);
}
