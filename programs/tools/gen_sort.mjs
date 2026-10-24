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
const INPUT = [42, 7, 19, 3, 88, 7, 55, 1];

for (let bits = 0; bits < 1 << N; bits++) {
  const a = Array.from({ length: N }, (_, i) => (bits >> i) & 1);
  for (const [i, j] of NETWORK) if (a[j] < a[i]) [a[i], a[j]] = [a[j], a[i]];
  for (let i = 1; i < N; i++) if (a[i - 1] > a[i]) throw new Error(`network fails on 0/1 input ${bits.toString(2)}`);
}

const reg = (i) => `r${i + 1}`; // value i lives in r1..r8; r9 is the swap bit, r10 the garbage pointer, r11 the array pointer
const lines = [];
const emit = (s = '') => lines.push(s);

emit(`; Reversible sort of 8 numbers that EXPOSES ITS GARBAGE.
;
; Sorting destroys information: [3,1,2] and [1,2,3] both become [1,2,3]. A reversible machine cannot do that
; silently, so this sort keeps a record of what it did. It is a fixed network of ${NETWORK.length} compare-exchange steps; each
; step compares two values, swaps them if they are out of order, and files one bit away: 1 = swapped, 0 = not.
; Those ${NETWORK.length} bits (one per word, at "garbage") are the garbage. Sorted array + garbage = the original,
; so running the program backwards (direction -1) unsorts it exactly. Look at the garbage words in the memory panel
; while you step: they fill in as the sort proceeds, and empty again when you step back.
;
; No other garbage: every temporary register ends at zero.
;
; One compare-exchange (values in ri, rj with i < j; r9 is the swap bit):
;     .if  lt, rj, ri       out of order?
;     swap ri, rj           yes: swap them
;     xori r9, 1            ... and remember that we did
;     .fi  eq, r9, r0       the bit is 0 iff we came from the "no swap" side (this is the exit assertion)
;     xst r9, [garbage+k]   file the bit away in memory ...
;     xld r9, [garbage+k]   ... and clear r9 (mem ^= r9 then r9 ^= mem leaves r9 = 0)
;
; Values are moved between memory and registers with xld then xst (no overwriting), as in cipher.s.
; Registers: r1..r8 the values, r9 swap bit, r10 garbage pointer, r11 array pointer.
        .data
arr:    .word  ${INPUT.join(', ')}
garbage: .space ${NETWORK.length}

        .code
start:  addi   r10, garbage
        addi   r11, arr
`);
emit('        ; load: move each value from memory into a register (memory becomes 0)');
for (let i = 0; i < N; i++) {
  emit(`        xld    ${reg(i)}, [r11+${i}]`);
  emit(`        xst    ${reg(i)}, [r11+${i}]`);
}
emit('');
emit('        ; the sorting network');
NETWORK.forEach(([i, j], k) => {
  emit(`        .if    lt, ${reg(j)}, ${reg(i)}            ; step ${k + 1}: compare-exchange (${i},${j})`);
  emit(`        swap   ${reg(i)}, ${reg(j)}`);
  emit('        xori   r9, 1');
  emit('        .fi    eq, r9, r0');
  emit(`        xst    r9, [r10+${k}]`);
  emit(`        xld    r9, [r10+${k}]`);
});
emit('');
emit('        ; store: move each sorted value back into memory (registers become 0)');
for (let i = 0; i < N; i++) {
  emit(`        xst    ${reg(i)}, [r11+${i}]`);
  emit(`        xld    ${reg(i)}, [r11+${i}]`);
}
emit('');
emit('        subi   r10, garbage');
emit('        subi   r11, arr');
emit('        hlt');

const out = fileURLToPath(new URL('../sort.s', import.meta.url));
writeFileSync(out, lines.join('\n') + '\n');
console.log(`wrote ${out}: ${NETWORK.length} comparators, network verified on all ${1 << N} 0/1 inputs`);
