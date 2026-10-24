import { describe, expect, it } from 'vitest';
import { FB_WORDS, STACK_BASE } from '../../../spec/vm_api';
import { callReturn, countingLoop, gradient, ifElse } from '../src/programs';
import { load, run } from './helpers';

const regs = (vm: ReturnType<typeof load>) => Array.from(vm.registers().regs);

describe('if / else', () => {
  it('takes the then branch when r1 == r2', () => {
    const vm = load(ifElse(4, 4));
    expect(run(vm)).toBe('halted');
    expect(regs(vm)[4]).toBe(0x22);
    expect(vm.instructionCount).toBe(6);
  });

  it('takes the else branch when r1 != r2', () => {
    const vm = load(ifElse(3, 5));
    expect(run(vm)).toBe('halted');
    expect(regs(vm)[4]).toBe(0x11);
    expect(vm.instructionCount).toBe(6);
  });
});

describe('counting loop', () => {
  for (const n of [1, 2, 5, 12]) {
    it(`runs ${n} iterations`, () => {
      const vm = load(countingLoop(n));
      expect(run(vm)).toBe('halted');
      const r = regs(vm);
      expect(r[1]).toBe(n);
      expect(r[3]).toBe(2 * n);
      expect(vm.instructionCount).toBe(1 + 4 * n);
    });
  }
});

describe('call / return', () => {
  it('calls f twice and leaves the stack empty and zeroed', () => {
    const vm = load(callReturn());
    expect(run(vm)).toBe('halted');
    expect(regs(vm)[1]).toBe(9);
    expect(regs(vm)[14]).toBe(STACK_BASE);
    expect(Array.from(vm.memory(STACK_BASE, 8))).toEqual(new Array(8).fill(0));
  });

  it('keeps the return address on the stack while inside f', () => {
    const vm = load(callReturn());
    vm.runTo(3); // xori, call, proc: now inside f
    expect(vm.registers().regs[14]).toBe(STACK_BASE + 1);
    expect(vm.memory(STACK_BASE, 1)[0]).toBe(2);
  });
});

describe('gradient', () => {
  it('fills every framebuffer pixel with i * 0x010203', () => {
    const vm = load(gradient());
    expect(run(vm)).toBe('halted');
    const fb = vm.framebuffer();
    expect(fb.length).toBe(FB_WORDS);
    for (const i of [0, 1, 2, 100, 2047]) expect(fb[i]).toBe(Math.imul(i, 0x010203) >>> 0);
  });
});
