// A key can arrive between ANY two instructions. Pong must survive it at every offset within a frame: no fault (the logging engine
// checks every landing), both engines in the same state, and the run still goes back to the start exactly.
// Regression: pong.rev used to read the input twice (build a temporary from it, then take it out again), so a key landing between the
// two reads left a temporary non-zero and the next landing assertion failed.
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';

import { assemble } from '../../../asm/src/index.js';
import { compile } from '../../../lang/src/compile.js';
import { createWasmVm, type WasmVm } from '../src/index.js';

const read = (p: string): string => readFileSync(new URL(`../../../examples/demos/${p}`, import.meta.url), 'utf8');
const IMAGES: Record<string, Uint8Array> = { 'pong.s': assemble(read('pong.s')).image!, 'pong.rev': compile(read('pong.rev')).image! };
const made: WasmVm[] = [];
afterAll(() => made.forEach((v) => v.destroy()));

async function play(kind: 'logging' | 'reversible', image: Uint8Array, keyAt: number[], keys: number[], end: number): Promise<WasmVm> {
  const vm = await createWasmVm(kind);
  made.push(vm);
  expect(vm.loadProgram(image)).toBe('ok');
  for (let n = 0; n < keyAt.length; n++) {
    expect(vm.runTo(keyAt[n])).toBe('ok');
    vm.pushInput(keys[n]);
  }
  expect(vm.runTo(end), vm.lastError).toBe('ok');
  return vm;
}

describe.each(['pong.s', 'pong.rev'])('a key at every offset in a frame (%s)', (program) => {
  it('never faults, both engines agree, and the run goes back to the start', async () => {
    const image = IMAGES[program];
    const start = await createWasmVm('reversible');
    made.push(start);
    start.loadProgram(image);
    const memAtStart = Array.from(start.memory(0, 0x20800));
    // every 3rd offset by default, which still lands inside every window the old bug had (they were over 100 steps wide); KEYRACE_STRIDE=1 tries them all
    const stride = Number(process.env.KEYRACE_STRIDE ?? 3);
    for (let off = 0; off < 620; off += stride) {
      const at = [3000 + off, 3000 + off + 7 + (off % 13)]; // two keys close together: the second can land inside the first one's read
      const keys = [0x80, 0x57];
      const log = await play('logging', image, at, keys, 7000);
      const rev = await play('reversible', image, at, keys, 7000);
      expect(Array.from(rev.registers().regs), `offset ${off}: registers`).toEqual(Array.from(log.registers().regs));
      expect(Array.from(rev.memory(0, 0x20800)), `offset ${off}: memory`).toEqual(Array.from(log.memory(0, 0x20800)));
      if (off % 40 === 0) {
        expect(rev.runTo(0)).toBe('ok');
        expect(Array.from(rev.memory(0, 0x20800))).toEqual(memAtStart);
      }
      log.destroy();
      rev.destroy();
    }
  }, 600_000);
});
