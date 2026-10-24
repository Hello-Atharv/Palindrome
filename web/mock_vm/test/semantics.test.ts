import { describe, expect, it } from 'vitest';
import { FB_BASE, IN_BASE, STACK_BASE } from '../../../spec/vm_api';
import { ProgramBuilder } from '../src/builder';
import { load, run, snap } from './helpers';

const prog = (f: (p: ProgramBuilder) => void, data: number[] = []) => {
  const p = new ProgramBuilder();
  f(p);
  return p.hlt().build(data);
};
const regs = (vm: ReturnType<typeof load>) => Array.from(vm.registers().regs);

describe('data instructions', () => {
  it('ADD/SUB/ADDI wrap mod 2^32', () => {
    const vm = load(prog((p) => p.addi(1, -1).addi(2, 5).add(1, 2).sub(2, 1).addi(3, 7)));
    expect(run(vm)).toBe('halted');
    const r = regs(vm);
    expect(r[1]).toBe(4);
    expect(r[2]).toBe(1);
    expect(r[3]).toBe(7);
  });

  it('XOR, XORI, NOT, SWAP, ROLI', () => {
    const vm = load(prog((p) => p.xori(1, 0xf0f0).xori(2, 0xff).xor(1, 2).not(3).swap(4, 1).xori(5, 0x30001).roli(5, 4)));
    run(vm);
    const r = regs(vm);
    expect(r[1]).toBe(0);
    expect(r[4]).toBe(0xf00f);
    expect(r[3]).toBe(0xffffffff);
    expect(r[5]).toBe(0x300010);
  });

  it('ROLI by 0 and 32 is the identity, negative counts use k mod 32', () => {
    const vm = load(prog((p) => p.xori(1, 0x12345).roli(1, 0).roli(1, 32).roli(2, 1).roli(1, -31)));
    run(vm);
    // -31 mod 32 = 1
    expect(regs(vm)[1]).toBe(0x2468a);
  });

  it('CSWAP swaps only when rc != 0; TOFF is ra ^= rb & rc', () => {
    const vm = load(prog((p) => p.xori(1, 1).xori(2, 2).xori(5, 1).cswap(5, 1, 2).cswap(6, 1, 2)
      .xori(7, 0b1100).xori(8, 0b1010).toff(9, 7, 8)));
    run(vm);
    const r = regs(vm);
    expect([r[1], r[2]]).toEqual([2, 1]);
    expect(r[9]).toBe(0b1000);
  });

  it('XST/XLD move data through memory by xor', () => {
    const vm = load(prog((p) => p.xori(1, 0x1234).xst(1, 0, 40).xld(2, 0, 40).xld(3, 0, 0)), [0xabcd]);
    run(vm);
    expect(vm.memory(40, 1)[0]).toBe(0x1234);
    expect(regs(vm)[2]).toBe(0x1234);
    expect(regs(vm)[3]).toBe(0xabcd);
  });

  it('draws into the framebuffer', () => {
    const vm = load(prog((p) => p.xori(1, FB_BASE).xori(2, 0x3f0ff).xst(2, 1, 65)));
    run(vm);
    expect(vm.framebuffer()[65]).toBe(0x3f0ff);
  });
});

describe('faults leave state unchanged and stop the VM', () => {
  const faultsOn = (f: (p: ProgramBuilder) => void, setup: (p: ProgramBuilder) => void = () => {}) => {
    const vm = load(prog((p) => { setup(p); f(p); }));
    const setupLen = new ProgramBuilder();
    setup(setupLen);
    for (let i = 0; i < setupLen.here; i++) expect(vm.stepForward()).toBe('ok');
    const before = snap(vm);
    expect(vm.stepForward()).toBe('fault');
    expect(vm.lastError).not.toBe('');
    expect(snap(vm)).toEqual(before);
    expect(vm.stepForward()).toBe('fault'); // still stuck
  };

  it('ra == rb on ADD/SUB/XOR/XLD', () => {
    faultsOn((p) => p.add(1, 1));
    faultsOn((p) => p.sub(1, 1));
    faultsOn((p) => p.xor(1, 1));
    faultsOn((p) => p.xld(1, 1, 0));
  });

  it('rc/ra aliasing on CSWAP and TOFF', () => {
    faultsOn((p) => p.cswap(1, 1, 2));
    faultsOn((p) => p.toff(1, 1, 2));
    faultsOn((p) => p.toff(1, 2, 1));
  });

  it('unmapped reads, read-only and unmapped writes', () => {
    faultsOn((p) => p.xld(2, 1, 0), (p) => p.xori(1, 0x28000));
    faultsOn((p) => p.xst(2, 1, 0), (p) => p.xori(1, IN_BASE));
    faultsOn((p) => p.xst(2, 1, 0), (p) => p.xori(1, 0x28000));
  });

  it('CALL to a non-PROC, RET on an empty stack, running off the code', () => {
    faultsOn((p) => p.call('x').label('x').nop());
    faultsOn((p) => p.ret());
    const vm = load(new ProgramBuilder().nop().build());
    expect(vm.stepForward()).toBe('ok');
    expect(vm.stepForward()).toBe('fault');
  });

  it('LND whose condition disagrees with how it was reached', () => {
    faultsOn((p) => p.label('start').lnd('al', 0, 0, 'start'));
  });
});

describe('time boundaries', () => {
  it('HLT stops before executing and does not advance t', () => {
    const vm = load(prog((p) => p.nop()));
    expect(vm.stepForward()).toBe('ok');
    expect(vm.stepForward()).toBe('halted');
    expect(vm.instructionCount).toBe(1);
    expect(vm.stepForward()).toBe('halted');
  });

  it('stepBack at t=0 is at_start', () => {
    const vm = load(prog((p) => p.nop()));
    expect(vm.stepBack()).toBe('at_start');
  });

  it('reset state: r14 = SP, other registers 0, data image loaded', () => {
    const vm = load(prog((p) => p.nop(), [5, 6]));
    const { regs: r, pc } = vm.registers();
    expect(r[14]).toBe(STACK_BASE);
    expect(Array.from(r).filter((x, i) => i !== 14 && x !== 0)).toEqual([]);
    expect(pc).toBe(0);
    expect(Array.from(vm.memory(0, 3))).toEqual([5, 6, 0]);
  });

  it('rejects bad programs and reports no-program', () => {
    const vm = load(prog((p) => p.nop()));
    expect(vm.loadProgram(new Uint8Array(3))).toBe('bad_program');
    expect(vm.lastError).not.toBe('');
  });
});
