/**
 * Hand-assembled sample programs (control flow follows SPEC.md section 6).
 * Register use is noted per program; r0 stays 0 and r14 is the stack pointer.
 */
import { FB_BASE, FB_WORDS } from '../../../spec/vm_api';
import { ProgramBuilder } from './builder';
import type { Built } from './builder';

/** if r1 == r2 then r4 ^= 0x22 else r4 ^= 0x11. Spec section 6 worked example. */
export function ifElse(a: number, b: number): Built {
  return new ProgramBuilder()
    .label('start').xori(1, a)
    .xori(2, b)
    .label('S0').br('eq', 1, 2, 'Lthen')
    .xori(4, 0x11) // else body
    .label('S1').br('al', 0, 0, 'Lend')
    .label('Lthen').lnd('al', 0, 0, 'S0')
    .xori(4, 0x22) // then body
    .label('Lend').lnd('ne', 1, 2, 'S1')
    .hlt()
    .build();
}

/** Counting loop: runs n >= 1 times; ends with r1 = n, r3 = 2n. The head LND tells "first entry" (r1 = 0) from "back edge". */
export function countingLoop(n: number): Built {
  return new ProgramBuilder()
    .label('start').xori(2, n)
    .label('Lhead').lnd('ne', 1, 0, 'Lback')
    .addi(1, 1)
    .addi(3, 2)
    .label('Lback').br('ne', 1, 2, 'Lhead')
    .hlt()
    .build();
}

/** Calls f twice; f does r1 += 1. Ends with r1 = 9 and the stack empty again. */
export function callReturn(): Built {
  return new ProgramBuilder()
    .label('start').xori(1, 7)
    .call('f')
    .call('f')
    .hlt()
    .label('f').proc('f_end')
    .addi(1, 1)
    .label('f_end').ret()
    .build();
}

/** Fills the framebuffer with a colour ramp: pixel i = i * 0x010203 (low 24 bits). */
export function gradient(): Built {
  return new ProgramBuilder()
    .label('start').xori(1, FB_BASE)
    .xori(4, FB_WORDS)
    .label('Lhead').lnd('ne', 2, 0, 'Lback')
    .xst(3, 1, 0)
    .addi(1, 1)
    .addi(3, 0x010203)
    .addi(2, 1)
    .label('Lback').br('ne', 2, 4, 'Lhead')
    .hlt()
    .build();
}

export interface Sample {
  name: string;
  blurb: string;
  build: () => Built;
}

export const SAMPLES: Sample[] = [
  { name: 'gradient', blurb: 'fills the framebuffer in a loop (2048 iterations)', build: gradient },
  { name: 'counting loop', blurb: 'BR/LND loop, r1 counts to 12', build: () => countingLoop(12) },
  { name: 'if / else', blurb: 'r1 != r2, so the else branch runs', build: () => ifElse(3, 5) },
  { name: 'call / return', blurb: 'CALL, PROC and RET on the stack', build: callReturn },
];
