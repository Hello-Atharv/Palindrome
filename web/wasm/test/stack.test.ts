// A runaway recursion must fault at the end of the stack region, never spill into the framebuffer.
import { afterAll, describe, expect, it } from 'vitest';

import { assemble } from '../../../asm/src/index.js';
import { createWasmVm, type WasmVm } from '../src/index.js';

const made: WasmVm[] = [];
afterAll(() => made.forEach((v) => v.destroy()));

const RUNAWAY = 'start: call f\n hlt\nf: proc f_end\n call f\nf_end: ret\n';

describe.each(['logging', 'reversible'] as const)('stack bounds (%s engine)', (kind) => {
  it('recursing forever faults at the top of the stack and leaves the framebuffer untouched', async () => {
    const vm = await createWasmVm(kind);
    made.push(vm);
    expect(vm.loadProgram(assemble(RUNAWAY).image!)).toBe('ok');
    let status = 'ok';
    for (let n = 0; n < 200_000 && (status = vm.stepForward()) === 'ok'; n++);
    expect(status).toBe('fault');
    expect(vm.lastError).toMatch(/stack/);
    expect(vm.registers().regs[14]).toBe(0x20000); // the last legal stack slot was 0x1FFFF
    expect(vm.framebuffer().every((w) => w === 0)).toBe(true);
  });
});
