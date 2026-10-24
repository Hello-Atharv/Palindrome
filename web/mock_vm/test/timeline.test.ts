import { describe, expect, it } from 'vitest';
import { IN_BASE } from '../../../spec/vm_api';
import { ProgramBuilder } from '../src/builder';
import { Tape } from '../src/tape';
import { countingLoop } from '../src/programs';
import { load, run, snap } from './helpers';

/** Reads the input window: r2 = COUNT, r3 = TIME, r4 = event 0 (all xor-ed into zeroed registers). */
const reader = () =>
  new ProgramBuilder()
    .nop().nop()
    .xori(1, IN_BASE) // index 2
    .xld(2, 1, 1) // index 3: COUNT
    .xld(3, 1, 0) // index 4: TIME
    .xld(4, 1, 2) // index 5: event 0
    .hlt()
    .build();

const regs = (vm: ReturnType<typeof load>) => Array.from(vm.registers().regs);

describe('input window', () => {
  it('shows events stamped at or before t, with the window read at the pre-step t', () => {
    const vm = load(reader());
    vm.runTo(2);
    expect(vm.pushInput(77)).toBe('ok'); // stamped t = 2
    run(vm);
    const r = regs(vm);
    expect(r[2]).toBe(1); // COUNT at t=3
    expect(r[3]).toBe(4); // TIME at t=4
    expect(r[4]).toBe(77);
  });

  it('hides an event before its timestamp and again after stepping back past it', () => {
    const vm = load(reader());
    vm.runTo(3);
    vm.pushInput(9); // stamped t = 3: visible to the step 3 -> 4 and later
    run(vm);
    expect(regs(vm)[4]).toBe(9);
    vm.runTo(2); // before the stamp; the event is still on the tape but invisible
    expect(vm.memory(IN_BASE + 1, 1)[0]).toBe(0);
    vm.runTo(3);
    expect(vm.memory(IN_BASE + 1, 1)[0]).toBe(1);
  });

  it('is read-only', () => {
    const vm = load(new ProgramBuilder().xori(1, IN_BASE).xst(2, 1, 0).hlt().build());
    vm.stepForward();
    expect(vm.stepForward()).toBe('fault');
  });

  it('loads a recorded tape and restarts at t=0', () => {
    const tape = new Tape();
    tape.append(0, 5);
    const vm = load(reader());
    vm.runTo(3);
    expect(vm.setInputTape(tape.serialize())).toBe('ok');
    expect(vm.instructionCount).toBe(0);
    run(vm);
    expect(regs(vm)[4]).toBe(5);
    expect(vm.setInputTape(new Uint8Array(3))).toBe('bad_arg');
  });
});

describe('host actions start a new branch', () => {
  it('stepping back and forward with no host action is lossless', () => {
    const vm = load(reader());
    vm.runTo(2);
    vm.pushInput(77);
    run(vm);
    const end = snap(vm);
    vm.runTo(1);
    vm.runTo(end.t);
    expect(snap(vm)).toEqual(end);
  });

  it('pushInput after scrubbing back drops later events', () => {
    const vm = load(reader());
    vm.runTo(4);
    vm.pushInput(1);
    vm.runTo(6); // still before halting; event stamped 4
    vm.runTo(2);
    vm.pushInput(2); // new branch at t=2: the event stamped 4 is gone
    run(vm);
    const r = regs(vm);
    expect(r[2]).toBe(1); // only one event visible
    expect(r[4]).toBe(2);
  });

  it('setDirection drops later flips; the direction follows t when scrubbing', () => {
    const vm = load(countingLoop(3));
    vm.runTo(5);
    expect(vm.setDirection(-1)).toBe('ok');
    expect(vm.direction).toBe(-1);
    vm.stepForward(); // reverse step: t=6, state of t=4
    vm.stepBack();
    expect(vm.instructionCount).toBe(5);
    vm.runTo(3);
    expect(vm.direction).toBe(1); // the flip is at t=5
    vm.runTo(5);
    expect(vm.direction).toBe(-1);
    vm.runTo(2);
    expect(vm.setDirection(1)).toBe('ok'); // host action at t=2 discards the flip at t=5
    vm.runTo(5);
    expect(vm.direction).toBe(1);
    expect(vm.setDirection(2 as 1)).toBe('bad_arg');
  });
});

describe('history accounting', () => {
  it('logging VM history grows with t and shrinks on stepBack; flips cost 8 bytes', () => {
    const vm = load(countingLoop(50));
    const h0 = vm.historyBytes;
    expect(h0).toBe(0);
    vm.runTo(100);
    const h100 = vm.historyBytes;
    expect(h100).toBeGreaterThan(h0);
    vm.runTo(200);
    expect(vm.historyBytes).toBeGreaterThan(h100);
    vm.runTo(100);
    expect(vm.historyBytes).toBe(h100);
    vm.setDirection(-1);
    expect(vm.historyBytes).toBe(h100 + 8);
  });

  it('runTo stops early on halt and reports it', () => {
    const vm = load(countingLoop(2));
    expect(vm.runTo(1000)).toBe('halted');
    expect(vm.instructionCount).toBe(9);
    expect(vm.runTo(-1)).toBe('bad_arg');
  });
});
