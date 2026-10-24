// Generates programs/sort.s from a sorting network. Run: node programs/tools/gen_sort.mjs
// The network is the known 19-comparator, depth-6 network for 8 inputs; the generator proves it sorts every
// 0/1 input (the 0-1 principle), so it sorts every input.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const NETWORK = [
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
  [0, 1], [2, 3], [4, 5], [6, 7],
  [2, 4], [3, 5],
  [1, 4], [3, 6],
  [1, 2], [3, 4], [5, 6],
];
const N = 8;
// The values are colours, because the array LIVES ON THE SCREEN (framebuffer words are pixels): the red channel is the
// value, so sorted order is a gradient from green (small) to red (large). The program draws nothing.
const colour = (r) => ((r << 16) | ((255 - r) << 8) | 0x40) >>> 0;
const INPUT_R = [0xb0, 0x30, 0x70, 0x20, 0xf0, 0x30, 0xc0, 0x10];
const INPUT = INPUT_R.map(colour);
const hex = (v) => '0x' + v.toString(16).padStart(6, '0');

for (let bits = 0; bits < 1 << N; bits++) {
  const a = Array.from({ length: N }, (_, i) => (bits >> i) & 1);
  for (const [i, j] of NETWORK) if (a[j] < a[i]) [a[i], a[j]] = [a[j], a[i]];
  for (let i = 1; i < N; i++) if (a[i - 1] > a[i]) throw new Error(`network fails on 0/1 input ${bits.toString(2)}`);
}

const lines = [];
const emit = (s = '') => lines.push(s);

emit(`; Reversible sort of 8 numbers that EXPOSES ITS GARBAGE, drawn on the screen.
;
; THE LIST IS ON THE SCREEN. The 8 values are colours (the red channel is the value) and they live in the framebuffer,
; so the screen itself is the visualisation: row 0 is the list, row 1 is the garbage. The program draws nothing.
; Small values are green, large ones red: when it is sorted, row 0 is a gradient. Step through and watch the
; compared pair vanish into registers and come back swapped.
;
; Sorting destroys information: [3,1,2] and [1,2,3] both become [1,2,3]. A reversible machine cannot do that silently,
; so this sort keeps a record. It is a fixed network of ${NETWORK.length} compare-exchange steps; each compares two values, swaps them if
; they are out of order, and files one bit away on screen row 1: cyan = swapped, black = not. Those ${NETWORK.length} pixels are the
; garbage. Sorted list + garbage = the original, so running the program backwards (direction -1) unsorts it exactly and
; clears the garbage. No other garbage: every temporary register ends at zero.
;
; One compare-exchange (list entries i < j live at screen words i and j; r9 is the swap flag):
;     xld r1,[r11+i] / xst r1,[r11+i]    move entry i off the screen into r1 (a move: nothing is overwritten)
;     xld r2,[r11+j] / xst r2,[r11+j]    same for entry j
;     .if  lt, r2, r1       out of order?
;     swap r1, r2           yes: swap them
;     xori r9, 0xFFFF       ... and set the flag
;     .fi  eq, r9, r0       flag = 0 iff we came from the "no swap" side (this is the exit assertion)
;     xst r1,[r11+i] / xld r1,[r11+i]    put them back on the screen and clear the registers
;     xst r2,[r11+j] / xld r2,[r11+j]
;     xst r9,[r10+k] / xld r9,[r10+k]    file the flag on screen row 1 and clear r9
;
; The input colours start in the data region (programs are loaded there) and are moved onto the screen first.
; Registers: r1, r2 the pair, r9 swap flag, r10 screen row 1 (garbage), r11 screen row 0 (the list).
        .equ   FB, 0x20000
        .data
arr:    .word  ${INPUT.map(hex).join(', ')}

        .code
start:  xori   r11, FB              ; r11 = screen row 0
        xori   r10, FB+64           ; r10 = screen row 1
`);
emit('        ; move the input from the data region onto the screen (data becomes 0)');
for (let i = 0; i < N; i++) {
  emit(`        xld    r1, [r0+${i}]`);
  emit(`        xst    r1, [r0+${i}]`);
  emit(`        xst    r1, [r11+${i}]`);
  emit(`        xld    r1, [r11+${i}]`);
}
emit('');
emit('        ; the sorting network, working directly on the screen');
NETWORK.forEach(([i, j], k) => {
  emit(`        xld    r1, [r11+${i}]               ; step ${k + 1}: compare-exchange (${i},${j})`);
  emit(`        xst    r1, [r11+${i}]`);
  emit(`        xld    r2, [r11+${j}]`);
  emit(`        xst    r2, [r11+${j}]`);
  emit('        .if    lt, r2, r1');
  emit('        swap   r1, r2');
  emit('        xori   r9, 0xFFFF');
  emit('        .fi    eq, r9, r0');
  emit(`        xst    r1, [r11+${i}]`);
  emit(`        xld    r1, [r11+${i}]`);
  emit(`        xst    r2, [r11+${j}]`);
  emit(`        xld    r2, [r11+${j}]`);
  emit(`        xst    r9, [r10+${k}]`);
  emit(`        xld    r9, [r10+${k}]`);
});
emit('');
emit('        xori   r10, FB+64           ; clean up the two screen pointers');
emit('        xori   r11, FB');
emit('        hlt');

const out = fileURLToPath(new URL('../sort.s', import.meta.url));
writeFileSync(out, lines.join('\n') + '\n');
console.log(`wrote ${out}: ${NETWORK.length} comparators, network verified on all ${1 << N} 0/1 inputs`);
