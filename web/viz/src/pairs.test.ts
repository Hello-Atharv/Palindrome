// Every program that is shown in both languages: the .rev and the .s do the same job on both real engines, and rewind to a clean start.
import { describe, expect, it } from 'vitest';
import { assemble } from '../../../asm/src/index';
import bennettS from '../../../examples/asm/bennett.s?raw';
import callS from '../../../examples/asm/call.s?raw';
import ifelseS from '../../../examples/asm/ifelse.s?raw';
import ifelseMacroS from '../../../examples/asm/ifelse_macro.s?raw';
import loopS from '../../../examples/asm/loop.s?raw';
import loopMacroS from '../../../examples/asm/loop_macro.s?raw';
import memoryS from '../../../examples/asm/memory.s?raw';
import nestedS from '../../../examples/asm/nested.s?raw';
import cipherS from '../../../examples/demos/cipher.s?raw';
import fib from '../../../examples/rev/fib.rev?raw';
import hello from '../../../examples/rev/hello.rev?raw';
import sort3 from '../../../examples/rev/sort3.rev?raw';
import tour from '../../../examples/rev/tour.rev?raw';
import { compile } from '../../../lang/src/compile';
import type { CompileResult } from '../../../lang/src/compile';
import { consoleText } from '../../../lang/src/console';
import type { RVM, VmKind } from '../../../spec/vm_api';
import { createWasmVm } from '../../wasm/src/index';
import { ADD_TWO_NUMBERS } from './examples';
import bennettRev from './programs/bennett.rev?raw';
import callRev from './programs/call.rev?raw';
import addTwoRev from './programs/add_two_numbers.rev?raw';
import cipherRev from './programs/cipher.rev?raw';
import gradientRev from './programs/gradient.rev?raw';
import gradientS from './programs/gradient.s?raw';
import ifElseRev from './programs/if_else.rev?raw';
import loopRev from './programs/loop.rev?raw';
import memoryRev from './programs/memory.rev?raw';
import myProgramRev from './programs/my_program.rev?raw';
import nestedRev from './programs/nested.rev?raw';

const KINDS: VmKind[] = ['logging', 'reversible'];
const made: RVM[] = [];

/** Load an image, send the inputs at t = 0, run to the end. */
async function run(kind: VmKind, image: Uint8Array, inputs: number[] = []): Promise<RVM> {
  const vm = await createWasmVm(kind);
  made.push(vm);
  expect(vm.loadProgram(image)).toBe('ok');
  for (const v of inputs) vm.pushInput(v);
  let status = 'ok';
  for (let i = 0; i < 3_000_000 && status === 'ok'; i++) status = vm.stepForward();
  expect(status).toBe('halted');
  return vm;
}
const asm = (source: string): Uint8Array => {
  const r = assemble(source);
  expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return r.image!;
};
const rev = (source: string): CompileResult => {
  const c = compile(source);
  expect(c.diagnostics).toEqual([]);
  expect(c.ok).toBe(true);
  return c;
};
/** A rev variable's value: in a register, or in data memory. */
const variable = (vm: RVM, c: CompileResult, name: string): number => {
  const v = c.vars.find((x) => x.name === name)!;
  return v.reg > 0 ? vm.registers().regs[v.reg] : vm.memory(v.addr!, 1)[0];
};
const reg = (vm: RVM, n: number): number => vm.registers().regs[n];
const screen = (vm: RVM): number[] => Array.from(vm.framebuffer());
const text = (vm: RVM): string => consoleText((a, n) => vm.memory(a, n));

describe.each(KINDS)('a program in .s and in .rev, on the %s engine', (kind) => {
  it('if / else: both versions take the same branch, with or without macros', async () => {
    const c = rev(ifElseRev);
    for (const src of [ifelseS, ifelseMacroS]) expect(reg(await run(kind, asm(src)), 3)).toBe(variable(await run(kind, c.image!), c, 'c')); // 7
    const other = rev(ifElseRev.replace('b = 5', 'b = 9')); // the else branch
    const otherAsm = ifelseS.replace('addi r2, 5', 'addi r2, 9');
    expect(reg(await run(kind, asm(otherAsm)), 3)).toBe(100);
    expect(variable(await run(kind, other.image!), other, 'c')).toBe(100);
  });

  it('loop: 4 * 4 = 16', async () => {
    const c = rev(loopRev);
    for (const src of [loopS, loopMacroS]) expect(reg(await run(kind, asm(src)), 3)).toBe(16);
    expect(variable(await run(kind, c.image!), c, 'total')).toBe(16);
  });

  it('nested loop with an if: the same three counts', async () => {
    const c = rev(nestedRev);
    const a = await run(kind, asm(nestedS));
    const r = await run(kind, c.image!);
    expect([reg(a, 2), reg(a, 5), reg(a, 6)]).toEqual([5, 1, 4]);
    expect([variable(r, c, 'i'), variable(r, c, 'hits'), variable(r, c, 'others')]).toEqual([5, 1, 4]);
  });

  it('call / return: 6, with the stack balanced', async () => {
    const c = rev(callRev);
    const a = await run(kind, asm(callS));
    const r = await run(kind, c.image!);
    expect(reg(a, 2)).toBe(6);
    expect(variable(r, c, 'total')).toBe(6);
    expect(reg(a, 14)).toBe(reg(r, 14)); // the stack pointer is back where it started in both
  });

  it('memory: the same pixels, and -0xBEEF in a register', async () => {
    const c = rev(memoryRev);
    const a = await run(kind, asm(memoryS));
    const r = await run(kind, c.image!);
    expect(screen(r)).toEqual(screen(a));
    expect(screen(r)[6]).toBe(0xbeef);
    expect(screen(r)[5]).toBe(0);
    expect(variable(r, c, 'b')).toBe(reg(a, 4));
    expect(reg(a, 4)).toBe((-0xbeef) >>> 0);
  });

  it('bennett: the same memory word and the same pixel', async () => {
    const c = rev(bennettRev);
    const a = await run(kind, asm(bennettS));
    const r = await run(kind, c.image!);
    expect(a.memory(0x100, 1)[0]).toBe(47);
    expect(r.memory(0x100, 1)[0]).toBe(47);
    expect(screen(r)).toEqual(screen(a));
    expect(screen(r)[131]).toBe(0xffffff);
  });

  it('add two numbers: the same console text for the same inputs', async () => {
    const c = rev(addTwoRev);
    for (const [inputs, expected] of [[[7, 5], '7\n5\n12\n'], [[(-3) >>> 0, 10], '-3\n10\n7\n']] as const) {
      expect(text(await run(kind, asm(ADD_TWO_NUMBERS), [...inputs]))).toBe(expected);
      expect(text(await run(kind, c.image!, [...inputs]))).toBe(expected);
    }
  });

  it('cipher: the same ciphertext on the screen', async () => {
    const a = await run(kind, asm(cipherS));
    const r = await run(kind, rev(cipherRev).image!);
    expect(screen(r).slice(0, 8)).toEqual(screen(a).slice(0, 8));
    expect(screen(r).slice(0, 8)).not.toEqual([0x48544f4e, 0x20474e49, 0x45205349, 0x20524556, 0x4f524854, 0x41204e57, 0x20594157, 0x45524548]); // it did encrypt
  });

  it('gradient: the same 2048 pixels', async () => {
    const a = await run(kind, asm(gradientS));
    const r = await run(kind, rev(gradientRev).image!);
    expect(screen(r)).toEqual(screen(a));
    expect(screen(r)[2]).toBe(2 * 0x010203);
  });
});

describe('every rev program rewinds to a clean start', () => {
  const sources: [string, string][] = [
    ['if_else', ifElseRev], ['loop', loopRev], ['nested', nestedRev], ['call', callRev], ['memory', memoryRev], ['bennett', bennettRev],
    ['add_two_numbers', addTwoRev], ['cipher', cipherRev], ['gradient', gradientRev], ['my_program', myProgramRev],
  ];
  it.each(sources)('%s: the whole run undone leaves every register, the screen and the console as at the start', async (_name, source) => {
    const c = rev(source);
    const vm = await run('reversible', c.image!, [4, 9]);
    const end = vm.instructionCount;
    expect(end).toBeGreaterThan(0);
    expect(vm.runTo(0)).toBe('ok');
    expect(Array.from(vm.registers().regs).filter((v, i) => i !== 14 && v !== 0)).toEqual([]);
    expect(screen(vm).filter((v) => v !== 0)).toEqual([]);
    expect(text(vm)).toBe('');
    expect(vm.runTo(end)).toBe('ok'); // and forward again
  });
});

describe('a .rev program with no .s shows the assembly the compiler writes', () => {
  it.each([['hello', hello], ['fib', fib], ['sort3', sort3], ['tour', tour]])('%s: the generated .s assembles to the same machine code', (_name, source) => {
    const c = rev(source);
    expect(c.asm!.length).toBeGreaterThan(50);
    const again = assemble(c.asm!);
    expect(again.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(Array.from(again.image!)).toEqual(Array.from(c.image!));
  });
});
