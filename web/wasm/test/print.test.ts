// The .print macro (SPEC 11.9) on both real engines: what it prints, that it leaves its scratch registers clean, and that the
// console rewinds with time.
import { afterAll, describe, expect, it } from 'vitest';

import { assemble } from '../../../asm/src/index.js';
import { consoleText, readConsole } from '../../../lang/src/console.js';
import { createWasmVm, type WasmVm } from '../src/index.js';

const made: WasmVm[] = [];
afterAll(() => made.forEach((v) => v.destroy()));

const PROGRAM = String.raw`
start:  addi  r1, 42
        addi  r2, -7
        .print "x = ", r10, r11
        .print r1, unsigned, r10, r11
        .print 10, r10, r11
        .print r2, signed, r10, r11
        .print " ", r10, r11
        .print 255, hex, r10, r11
        .print "!", r10, r11
        hlt
`;
const EXPECTED = 'x = 42\n-7 0xff!';

async function run(kind: 'logging' | 'reversible', src = PROGRAM): Promise<WasmVm> {
  const a = assemble(src);
  expect(a.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  const vm = await createWasmVm(kind);
  made.push(vm);
  expect(vm.loadProgram(a.image!)).toBe('ok');
  while (vm.stepForward() === 'ok') { /* run */ }
  return vm;
}
const text = (vm: WasmVm): string => consoleText((a, n) => vm.memory(a, n));

describe('.print', () => {
  it.each(['logging', 'reversible'] as const)('prints text, numbers and characters on the %s engine', async (kind) => {
    const vm = await run(kind);
    expect(text(vm)).toBe(EXPECTED);
    const regs = vm.registers().regs;
    expect(regs[10]).toBe(0); // the scratch registers are zero again
    expect(regs[11]).toBe(0);
    expect(regs[1]).toBe(42); // and nothing else was touched
    // 4 chars "x = " + 2 digits are one number entry + newline + number + space + hex + "!" = 4 + 1 + 1 + 1 + 1 + 1 + 1 = 10 entries
    expect(readConsole((a, n) => vm.memory(a, n)).length).toBe(10);
    expect(vm.memory(0xfffe, 1)[0]).toBe(20); // OUT_LEN counts words: two per entry
  });

  it('rewinds with time: stepping back un-prints, exactly, with no history kept', async () => {
    const vm = await run('reversible');
    const end = vm.instructionCount;
    const full = text(vm);
    expect(vm.historyBytes).toBe(0);
    // half way: a prefix of the text, never anything else
    expect(vm.runTo(Math.floor(end / 2))).toBe('ok');
    const mid = text(vm);
    expect(full.startsWith(mid)).toBe(true);
    expect(mid.length).toBeGreaterThan(0);
    expect(mid.length).toBeLessThan(full.length);
    // back to the start: the console and the whole buffer are empty again
    expect(vm.runTo(0)).toBe('ok');
    expect(text(vm)).toBe('');
    expect(vm.memory(0xfffe, 1)[0]).toBe(0);
    expect(vm.memory(0xe000, 64).every((w) => w === 0)).toBe(true);
    // and forward again reproduces it
    expect(vm.runTo(end)).toBe('ok');
    expect(text(vm)).toBe(full);
  });

  it('the text only grows by whole characters as time runs forward', async () => {
    const vm = await run('reversible');
    const end = vm.instructionCount;
    let prev = '';
    for (let t = 0; t <= end; t++) {
      vm.runTo(t);
      const now = text(vm);
      expect(now.startsWith(prev), `t=${t}`).toBe(true);
      prev = now;
    }
    expect(prev).toBe(EXPECTED);
  });

  it('works in a loop and inside an if, and is undone by running the program backwards (direction -1)', async () => {
    const src = String.raw`
start:  addi  r1, 3
        .loop ne, r2, r0
        .print r2, unsigned, r10, r11
        .print ",", r10, r11
        addi  r2, 1
        .again ne, r2, r1
        hlt
`;
    const vm = await run('reversible', src);
    expect(text(vm)).toBe('0,1,2,');
    expect(vm.setDirection(-1)).toBe('ok');
    while (vm.stepForward() === 'ok') { /* the program as its own inverse */ }
    expect(text(vm)).toBe(''); // un-printed
  });
});
