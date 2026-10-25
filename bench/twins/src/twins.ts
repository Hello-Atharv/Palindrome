// Conventional twins of the demo programs. Each does the same job as its reversible program (examples/demos/*.s) and must
// produce the same visible output, checked by test/twins.test.ts on the real engines. They are written the way you
// would write them on a normal machine: overwrite freely, branch on conditions, no garbage, no inverses.

import { FB } from './conv.js';

/** The 19-comparator, depth-6 network for 8 inputs that examples/demos/sort.s uses (see examples/demos/tools/gen_sort.mjs). */
export const NETWORK: [number, number][] = [
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
  [0, 1], [2, 3], [4, 5], [6, 7],
  [2, 4], [3, 5],
  [1, 4], [3, 6],
  [1, 2], [3, 4], [5, 6],
];

const colour = (r: number): number => ((r << 16) | ((255 - r) << 8) | 0x40) >>> 0;
export const SORT_INPUT = [0xb0, 0x30, 0x70, 0x20, 0xf0, 0x30, 0xc0, 0x10].map(colour);

/**
 * Sort twin: the same network, the same screen. The input is copied onto screen row 0 and each comparator loads the pair
 * and stores them back swapped when out of order. Nothing is recorded; the 19 flags the reversible sort files are not needed.
 */
export function sortTwin(input: number[] = SORT_INPUT): string {
  const out: string[] = [`        .data 0, ${input.map((x) => '0x' + x.toString(16)).join(', ')}`];
  out.push(`        movi r14, ${FB}`);
  input.forEach((_, i) => {
    out.push(`        ld r1, [r0+${i}]`, `        st r1, [r14+${i}]`);
  });
  NETWORK.forEach(([i, j], k) => {
    out.push(
      `        ld r1, [r14+${i}]`,
      `        ld r2, [r14+${j}]`,
      `        bge r2, r1, ok${k}              ; in order: leave them`,
      `        st r2, [r14+${i}]`,
      `        st r1, [r14+${j}]`,
      `ok${k}:`,
    );
  });
  out.push('        halt');
  return out.join('\n') + '\n';
}

/**
 * Pong twin: the same game as examples/demos/pong.s, pixel for pixel. The ball and paddle are drawn with XOR (so the picture
 * is identical even where they overlap) and the court has the same phase arithmetic for the ball, but the paddle is a
 * plain row number and every decision is an ordinary branch.
 *
 * Registers: r0 = 0 (never written), r1 ball x phase, r2 ball y phase, r3 paddle row, r4 next score block,
 * r6 bx, r7 by, r8 unfolded x (0..63), r9..r13 temporaries, r14 = FB.
 */
export function pongTwin(): string {
  const WHITE = 0xffffff;
  const CYAN = 0x00ffff;
  const YELLOW = 0xffff00;
  let n = 0;
  const L = (p: string): string => `${p}${n++}`;
  const lines: string[] = [];
  const emit = (...xs: string[]): number => lines.push(...xs.map((x) => (x.endsWith(':') ? x : '        ' + x)));

  /** screen[r10] ^= colour (clobbers r11) */
  const xorAt = (addrReg: string, off: number, colourValue: number): void => {
    emit(`ld r11, [${addrReg}+${off}]`, `xori r11, r11, ${colourValue}`, `st r11, [${addrReg}+${off}]`);
  };
  /** XOR the 4 paddle pixels (column 0, rows r3..r3+3 mod 32) */
  const paddle = (): void => {
    const loop = L('pl');
    emit('movi r9, 0', `${loop}:`);
    emit('add r10, r3, r9', 'andi r10, r10, 31', 'shli r10, r10, 6', 'add r10, r10, r14');
    xorAt('r10', 0, CYAN);
    emit('addi r9, r9, 1', 'movi r10, 4', `blt r9, r10, ${loop}`);
  };
  /** XOR the ball pixel at (r6, r7) */
  const ball = (): void => {
    emit('shli r10, r7, 6', 'add r10, r10, r6', 'add r10, r10, r14');
    xorAt('r10', 0, WHITE);
  };
  /** out = fold(phase): u = phase >> 26 into r8-like register `u`; out = u < 32 ? u : 63 - u */
  const fold = (phase: string, out: string, u: string): void => {
    const small = L('fs');
    const done = L('fd');
    emit(`shri ${u}, ${phase}, 26`, 'movi r12, 32', `blt ${u}, r12, ${small}`);
    emit('movi r12, 63', `sub ${out}, r12, ${u}`, `jmp ${done}`);
    emit(`${small}:`, `mov ${out}, ${u}`, `${done}:`);
  };

  // ---- setup ----
  emit(
    `movi r14, ${FB}`,
    `movi r1, ${10 * 2 ** 26}`,
    `movi r2, ${8 * 2 ** 26}`,
    'movi r3, 14',
    `movi r4, ${FB + 96}`,
  );
  fold('r1', 'r6', 'r8');
  fold('r2', 'r7', 'r9');
  paddle();
  ball();

  // ---- one frame ----
  emit('frame:');
  paddle(); // erase
  emit('ld r10, [r0+' + (0x30000 + 1) + ']', 'addi r10, r10, ' + (0x30000 + 1), 'ld r12, [r10+0]'); // latest key event
  const up = L('up');
  const down = L('dn');
  const moved = L('mv');
  emit('movi r13, 0x57', `beq r12, r13, ${up}`, 'movi r13, 0x80', `beq r12, r13, ${up}`);
  emit('movi r13, 0x53', `beq r12, r13, ${down}`, 'movi r13, 0x81', `bne r12, r13, ${moved}`);
  emit(`${down}:`, 'addi r3, r3, 1', 'andi r3, r3, 31', `jmp ${moved}`);
  emit(`${up}:`, 'addi r3, r3, -1', 'andi r3, r3, 31', `${moved}:`);
  paddle(); // draw

  ball(); // erase at the old position
  emit(`addi r1, r1, ${2 ** 26}`, `addi r2, r2, ${45 * 2 ** 20}`);
  fold('r1', 'r6', 'r8');
  fold('r2', 'r7', 'r9');
  ball(); // draw at the new position

  // contact: the ball has just arrived in the paddle column (unfolded x = 63)
  const noHit = L('nh');
  emit('movi r13, 63', `bne r8, r13, ${noHit}`);
  emit('sub r13, r7, r3', 'andi r13, r13, 31', 'movi r12, 3', 'blt r12, r13, over'); // more than 3 rows below the top: missed
  for (const off of [0, 1, 64, 65]) xorAt('r4', off, YELLOW);
  emit('addi r4, r4, 3', `${noHit}:`);

  emit('ld r10, [r0+65535]', 'addi r10, r10, 1', 'st r10, [r0+65535]', 'jmp frame'); // FRAME += 1
  emit('over:', 'halt');
  return lines.join('\n') + '\n';
}
