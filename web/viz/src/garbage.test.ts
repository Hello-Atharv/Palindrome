// @vitest-environment node
// The UI's garbage count must agree with the compiler's cost report: the same variables, read from the machine at the current time.
import { afterAll, describe, expect, it } from 'vitest';

import { analyze } from '../../../lang/src/report';
import { compile } from '../../../lang/src/compile';
import { createWasmVm, type WasmVm } from '../../wasm/src/index';
import { compileHook } from './catalogue';
import { garbageBitsOf } from './track';
import tour from '../../../examples/rev/tour.rev?raw';

const made: WasmVm[] = [];
afterAll(() => made.forEach((v) => v.destroy()));

describe('garbage bits of a rev program', () => {
  it('counts the flag and the loop counter, not the results, and follows time', async () => {
    const out = compileHook(tour, 'tour');
    expect(out.ok).toBe(true);
    const vars = out.variables!;
    const vm = await createWasmVm('reversible');
    made.push(vm);
    expect(vm.loadProgram(out.image!)).toBe('ok');

    expect(garbageBitsOf(vm, [], vars)).toBe(0); // nothing has run: nothing is kept

    expect(vm.runTo(1_000_000)).toBe('halted');
    const end = vm.instructionCount;
    // f = 1 and i = 3 are garbage (two words), `a`, `b` and `total` are results; the console holds 15 non-zero words
    expect(garbageBitsOf(vm, [], vars)).toBe((2 + 15) * 32);

    // the same variables the compiler's report calls garbage
    const report = await analyze(compile(tour), tour, 10_000);
    expect(report.garbageVars.sort()).toEqual(['f', 'i']);

    // stepping back un-keeps it: the number falls with time
    expect(vm.runTo(end - 1)).toBe('ok');
    expect(vm.runTo(0)).toBe('ok');
    expect(garbageBitsOf(vm, [], vars)).toBe(0);
  });

  it('falls back to the garbage-labelled ranges for an assembly program (no variables)', async () => {
    const vm = await createWasmVm('reversible');
    made.push(vm);
    expect(garbageBitsOf(vm, [[0, 4]], [])).toBe(0); // nothing loaded, all zero
  });
});
