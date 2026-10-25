import { compile } from '../../../lang/src/compile';
import pongRev from '../../../examples/demos/pong.rev?raw';
import type { RVM, VmKind } from '../../../spec/vm_api';
import { createWasmVm } from '../../wasm/src/index';
import { FrameTracker } from '../../wasm/src/frames';

const FIXED = process.env.FIXED === '1';
const lines = pongRev.split('\n');
// the second read of `latest` (the one that is meant to clear ev) becomes a read of the recorded copy
const at = lines.findIndex((l, i) => i > 112 && l.trim() === 'ev ^= latest;' && lines[i + 1].trim() === 'call draw_paddle;');
if (FIXED) {
  if (at < 0) throw new Error('patch did not apply');
  lines[at] = '    ev ^= log[lp];';
}
const src = lines.join('\n');
const compiled = compile(src);
if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
const image = compiled.image!;
const mk = async (k: VmKind): Promise<RVM> => { const v = await createWasmVm(k); v.loadProgram(image); return v; };
for (const kind of ['logging', 'reversible'] as const) {
  // the frame boundaries of an undisturbed run, to say where in the frame a failing moment is
  const probe = await mk(kind);
  const ft = new FrameTracker(probe);
  for (let i = 0; i < 12; i++) ft.stepFrame();
  const bounds = ft.boundaries.slice();
  const frameStart = (t: number): number => bounds.filter((b) => b <= t).pop() ?? 0;
  const fails: { t: number; err: string; at: number }[] = [];
  for (let t = 1500; t <= 4500; t += 3) {
    const v = await mk(kind);
    let s = 'ok';
    v.pushInput(0x80);                       // a first key event at t = 0
    for (let i = 0; i < t && s === 'ok'; i++) s = v.stepForward();
    if (s !== 'ok') continue;
    v.pushInput(0x57);                       // a second key event at t
    for (let i = 0; i < 600 && s === 'ok'; i++) s = v.stepForward();
    if (s === 'fault') fails.push({ t, err: v.lastError, at: v.instructionCount });
  }
  console.log(`--- ${kind}: frame boundaries at t = ${bounds.slice(0, 9).join(', ')} (a frame is about ${bounds[1] - bounds[0]} steps)`);
  console.log(fails.length === 0 ? '  no failure for a second key between t=1500 and 4500' : fails.map((f) => `  second key at t=${f.t} (${f.t - frameStart(f.t)} steps into its frame) -> "${f.err}" at t=${f.at}`).join('\n'));
}
