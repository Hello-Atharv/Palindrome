import { describe, expect, it } from 'vitest';
import { FB_BASE } from '../../../spec/vm_api';
import { ProgramBuilder } from '../src/builder';
import type { Built } from '../src/builder';
import { callReturn, countingLoop, gradient, ifElse } from '../src/programs';
import { load, rng, snap } from './helpers';
import type { Snap } from './helpers';

/** Everything except t (which differs by design after a reversed run). */
const state = (s: Snap) => ({ pc: s.pc, regs: s.regs, mem: s.mem });

/**
 * Forward to HLT recording snapshots every `stride` steps, then check:
 *  1. stepBack undoes every step exactly, down to at_start;
 *  2. forward again reproduces the end state;
 *  3. flipping direction at the end retraces the whole run (the program as its own inverse),
 *     reaching the entry point and halting;
 *  4. time travel back through the reversed run is also exact.
 */
function checkRoundTrip(b: Built, stride = 1): number {
  const vm = load(b);
  const snaps = new Map<number, Snap>([[0, snap(vm)]]);
  let T = 0;
  for (;;) {
    const s = vm.stepForward();
    if (s === 'halted') break;
    expect(s, vm.lastError).toBe('ok');
    if (++T % stride === 0) snaps.set(T, snap(vm));
  }
  snaps.set(T, snap(vm));
  const at = (t: number) => state(snaps.get(t)!);

  for (let t = T; t > 0; t--) {
    expect(vm.stepBack()).toBe('ok');
    if (snaps.has(t - 1)) expect(state(snap(vm))).toEqual(at(t - 1));
  }
  expect(vm.stepBack()).toBe('at_start');

  expect(vm.runTo(T)).toBe('ok');
  expect(state(snap(vm))).toEqual(at(T));

  expect(vm.setDirection(-1)).toBe('ok');
  expect(vm.direction).toBe(-1);
  for (let k = 1; k <= T; k++) {
    expect(vm.stepForward(), `reverse step ${k}: ${vm.lastError}`).toBe('ok');
    if (snaps.has(T - k)) expect(state(snap(vm))).toEqual(at(T - k));
  }
  expect(vm.stepForward()).toBe('halted');
  expect(vm.instructionCount).toBe(2 * T);

  expect(vm.runTo(T)).toBe('ok');
  expect(state(snap(vm))).toEqual(at(T));
  expect(vm.runTo(0)).toBe('ok');
  expect(state(snap(vm))).toEqual(at(0));
  return T;
}

describe('stepBack exactly undoes stepForward; direction -1 retraces the run', () => {
  it('if / else, both branches', () => {
    checkRoundTrip(ifElse(4, 4));
    checkRoundTrip(ifElse(3, 5));
    checkRoundTrip(ifElse(0, 0));
  });

  it('counting loop', () => {
    for (const n of [1, 2, 3, 7, 12]) checkRoundTrip(countingLoop(n));
  });

  it('call / return', () => {
    checkRoundTrip(callReturn());
  });

  it('framebuffer gradient (sampled)', () => {
    expect(checkRoundTrip(gradient(), 331)).toBe(2 + 6 * 2048);
  });
});

/** Random straight-line programs over every data instruction, with valid operands. */
function randomProgram(r: () => number, n: number): Built {
  const pick = (k: number) => Math.floor(r() * k);
  const p = new ProgramBuilder().label('start').xori(13, FB_BASE);
  for (let i = 1; i <= 12; i++) p.xori(i, pick(262144));
  for (let i = 0; i < n; i++) {
    const ra = 1 + pick(12);
    const other = () => {
      let x = 1 + pick(12);
      while (x === ra) x = 1 + pick(12);
      return x;
    };
    switch (pick(13)) {
      case 0: p.add(ra, other()); break;
      case 1: p.sub(ra, other()); break;
      case 2: p.addi(ra, pick(262144) - 131072); break;
      case 3: p.xor(ra, other()); break;
      case 4: p.xori(ra, pick(262144)); break;
      case 5: p.not(ra); break;
      case 6: p.swap(ra, other()); break;
      case 7: p.roli(ra, pick(64) - 16); break;
      case 8: p.xld(ra, 0, pick(512)); break; // data words
      case 9: p.xst(ra, 0, pick(512)); break;
      case 10: p.xst(ra, 13, pick(2048)); break; // framebuffer
      case 11: { const rc = other(); let a = other(); while (a === rc) a = other(); p.cswap(rc, ra, a); break; }
      default: { const rb2 = other(); let rc = other(); while (rc === rb2) rc = other(); p.toff(ra, rb2, rc); break; }
    }
  }
  return p.hlt().build();
}

describe('randomized round trip', () => {
  it('300 random programs of 150 instructions', () => {
    const r = rng(0xc0ffee);
    for (let i = 0; i < 300; i++) checkRoundTrip(randomProgram(r, 150), 10);
  });

  it('a few long ones, checked at every step', () => {
    const r = rng(42);
    for (let i = 0; i < 5; i++) checkRoundTrip(randomProgram(r, 300), 1);
  });
});
