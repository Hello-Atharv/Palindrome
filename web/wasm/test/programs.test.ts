// Demo programs from programs/, assembled and run on both real engines, checked against independent
// JavaScript reference implementations of the same algorithms (and, for Speck, the published test vector).
// Both demos keep their data ON THE SCREEN (framebuffer words are pixels), so the screen is the visualisation.
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';

import { assemble } from '../../../asm/src/index.js';
import { createWasmVm, type WasmVm } from '../src/index.js';

const source = (name: string): string => readFileSync(new URL(`../../../programs/${name}`, import.meta.url), 'utf8');

const made: WasmVm[] = [];
async function start(kind: 'logging' | 'reversible', src: string): Promise<WasmVm> {
  const r = assemble(src);
  expect(r.diagnostics).toEqual([]);
  const v = await createWasmVm(kind);
  made.push(v);
  expect(v.loadProgram(r.image!)).toBe('ok');
  return v;
}
afterAll(() => made.forEach((v) => v.destroy()));

function runToEnd(v: WasmVm): void {
  let s;
  while ((s = v.stepForward()) === 'ok') {}
  expect(s).toBe('halted');
}
/** Run the program as its own inverse until it reaches its start. */
function runReverse(v: WasmVm): void {
  expect(v.setDirection(-1)).toBe('ok');
  let s;
  while ((s = v.stepForward()) === 'ok') {}
  expect(s).toBe('halted');
}
const clean = (v: WasmVm): boolean => Array.from(v.registers().regs).every((r, i) => r === (i === 14 ? 0x10000 : 0));
const words = (v: WasmVm, addr: number, n: number): number[] => Array.from(v.memory(addr, n));
const screen = (v: WasmVm, from: number, n: number): number[] => Array.from(v.framebuffer().subarray(from, from + n));
const ZEROS = (n: number): number[] => new Array<number>(n).fill(0);

// ---- Speck64/128, written independently of the assembly ----------------------------------------------------------
const rotl = (x: number, k: number): number => ((x << k) | (x >>> (32 - k))) >>> 0;
const rotr = (x: number, k: number): number => rotl(x, 32 - k);

/** Round keys for key words [k0, l0, l1, l2] (the official key 1b1a1918 13121110 0b0a0908 03020100 is [03020100, 0b0a0908, 13121110, 1b1a1918]). */
function schedule(key: number[]): number[] {
  const rk = [key[0]];
  const l = [key[1], key[2], key[3]];
  for (let i = 0; i < 26; i++) {
    l.push((((rk[i] + rotr(l[i], 8)) >>> 0) ^ i) >>> 0);
    rk.push((rotl(rk[i], 3) ^ l[i + 3]) >>> 0);
  }
  return rk;
}
function speckEncrypt([x, y]: [number, number], rk: number[]): [number, number] {
  for (const k of rk) {
    x = (((rotr(x, 8) + y) >>> 0) ^ k) >>> 0;
    y = (rotl(y, 3) ^ x) >>> 0;
  }
  return [x, y];
}

const KEY = [0x03020100, 0x0b0a0908, 0x13121110, 0x1b1a1918];
const RK = schedule(KEY);
const TEXT = 'NOTHING IS EVER THROWN AWAY HERE';
const PLAIN = Array.from({ length: 8 }, (_, w) => {
  const c = (i: number): number => TEXT.charCodeAt(4 * w + i);
  return (c(0) | (c(1) << 8) | (c(2) << 16) | (c(3) << 24)) >>> 0;
});
const CIPHER = [0, 2, 4, 6].flatMap((i) => speckEncrypt([PLAIN[i], PLAIN[i + 1]], RK));
const MSG = 27; // data address of the message (after the 27 round keys)

describe('the Speck reference itself', () => {
  it('matches the published Speck64/128 test vector', () => {
    expect(speckEncrypt([0x3b726574, 0x7475432d], RK)).toEqual([0x8c6fa548, 0x454e028b]);
  });
});

describe.each(['logging', 'reversible'] as const)('cipher.s on the %s engine', (kind) => {
  it('starts with the round keys and plaintext in the data region and a black screen', async () => {
    const v = await start(kind, source('cipher.s'));
    expect(words(v, 0, 27)).toEqual(RK); // the program's key table is the real key schedule
    expect(words(v, MSG, 8)).toEqual(PLAIN);
    expect(v.framebuffer().every((w) => w === 0)).toBe(true);
  });

  it('reproduces the official Speck64/128 test vector on the machine', async () => {
    const src = source('cipher.s').replace(/^msg:.*$/m, 'msg:    .word  0x3b726574, 0x7475432d, 0, 0, 0, 0, 0, 0');
    const v = await start(kind, src);
    runToEnd(v);
    expect(screen(v, 0, 2)).toEqual([0x8c6fa548, 0x454e028b]);
  });

  it('encrypts on the screen exactly like the reference, with no garbage left behind', async () => {
    const v = await start(kind, source('cipher.s'));
    runToEnd(v);
    expect(screen(v, 0, 8)).toEqual(CIPHER); // the screen shows the ciphertext
    expect(v.framebuffer().subarray(8).every((w) => w === 0)).toBe(true);
    expect(words(v, MSG, 8)).toEqual(ZEROS(8)); // the message left the data region (it was moved, not copied)
    expect(words(v, 0, 27)).toEqual(RK); // the key table is untouched
    expect(clean(v)).toBe(true); // every temporary register is back to zero
    expect(new Set(CIPHER.map((w) => w & 0xffffff)).size).toBe(8); // 8 different colours
  });

  it('shows the plaintext on the screen before encrypting it (dull pixels, then noise)', async () => {
    const v = await start(kind, source('cipher.s'));
    let guard = 0;
    while (v.framebuffer()[7] === 0 && guard++ < 1000) v.stepForward(); // until the last message word is on screen
    expect(screen(v, 0, 8)).toEqual(PLAIN);
    expect(words(v, MSG, 8)).toEqual(ZEROS(8));
    const dull = PLAIN.every((w) => {
      const [r, g, b] = [(w >>> 16) & 255, (w >>> 8) & 255, w & 255];
      return Math.max(r, g, b) < 0x60 && Math.min(r, g, b) >= 0x20; // ASCII letters and spaces make a dull grey-blue
    });
    expect(dull).toBe(true);
  });

  it('decrypts by running the same program in reverse (direction -1)', async () => {
    const v = await start(kind, source('cipher.s'));
    runToEnd(v);
    const steps = v.instructionCount;
    runReverse(v);
    expect(v.instructionCount).toBe(2 * steps); // it is a real computation: time keeps moving forward
    expect(words(v, MSG, 8)).toEqual(PLAIN); // the plaintext is back in the data region
    expect(v.framebuffer().every((w) => w === 0)).toBe(true);
    expect(clean(v)).toBe(true);
  });

  it('can be scrubbed back to the start, restoring the plaintext', async () => {
    const v = await start(kind, source('cipher.s'));
    runToEnd(v);
    expect(v.runTo(0)).toBe('ok');
    expect(words(v, MSG, 8)).toEqual(PLAIN);
    expect(v.framebuffer().every((w) => w === 0)).toBe(true);
  });

  it('reports its size and cost', async () => {
    const v = await start(kind, source('cipher.s'));
    runToEnd(v);
    const r = assemble(source('cipher.s'));
    console.log(`cipher.s ${kind}: ${r.code.length} instructions, ${v.instructionCount} steps, history ${v.historyBytes} bytes`);
    expect(r.code.length).toBeLessThan(70);
    expect(v.instructionCount).toBe(1203);
  });
});

// ---- sort.s: a reversible sort that exposes its garbage, on the screen -----------------------------------------------
const NETWORK: [number, number][] = [
  [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7], [0, 1], [2, 3], [4, 5], [6, 7],
  [2, 4], [3, 5], [1, 4], [3, 6], [1, 2], [3, 4], [5, 6],
];
const colour = (r: number): number => ((r << 16) | ((255 - r) << 8) | 0x40) >>> 0;
const SORT_INPUT = [0xb0, 0x30, 0x70, 0x20, 0xf0, 0x30, 0xc0, 0x10].map(colour);
const FLAG = 0xffff; // the colour the program writes for "swapped"
const GARBAGE = 64; // screen row 1: one pixel per comparator

function refSort(input: number[]): { sorted: number[]; flags: number[] } {
  const a = [...input];
  const flags: number[] = [];
  for (const [i, j] of NETWORK) {
    const swapped = a[j] < a[i];
    if (swapped) [a[i], a[j]] = [a[j], a[i]];
    flags.push(swapped ? FLAG : 0);
  }
  return { sorted: a, flags };
}
const sortWith = (vals: number[]): string =>
  source('sort.s').replace(/^arr:.*$/m, `arr:    .word  ${vals.map((x) => '0x' + x.toString(16)).join(', ')}`);

describe.each(['logging', 'reversible'] as const)('sort.s on the %s engine', (kind) => {
  it('starts with the list in the data region and a black screen', async () => {
    const v = await start(kind, source('sort.s'));
    expect(words(v, 0, 8)).toEqual(SORT_INPUT);
    expect(v.framebuffer().every((w) => w === 0)).toBe(true);
  });

  it('sorts on the screen, records one pixel per comparator, and leaves no other garbage', async () => {
    const v = await start(kind, source('sort.s'));
    runToEnd(v);
    const ref = refSort(SORT_INPUT);
    expect(ref.sorted).toEqual([...SORT_INPUT].sort((a, b) => a - b));
    expect(screen(v, 0, 8)).toEqual(ref.sorted); // row 0: the sorted list, a colour gradient
    expect(screen(v, GARBAGE, 19)).toEqual(ref.flags); // row 1: the garbage
    expect(words(v, 0, 8)).toEqual(ZEROS(8)); // the list was moved onto the screen
    expect(clean(v)).toBe(true);
    // nothing else is lit
    const lit = Array.from(v.framebuffer()).filter((w) => w !== 0).length;
    expect(lit).toBe(8 + ref.flags.filter((f) => f !== 0).length);
  });

  it('unsorts exactly by running backwards (direction -1), clearing the garbage', async () => {
    const v = await start(kind, source('sort.s'));
    runToEnd(v);
    runReverse(v);
    expect(words(v, 0, 8)).toEqual(SORT_INPUT);
    expect(v.framebuffer().every((w) => w === 0)).toBe(true);
    expect(clean(v)).toBe(true);
  });

  it('sorts and unsorts 25 random inputs, duplicates included, matching the reference', async () => {
    const st = { s: 99 };
    const next = (): number => {
      st.s = (Math.imul(st.s, 1664525) + 1013904223) >>> 0;
      return st.s >>> 8;
    };
    for (let k = 0; k < 25; k++) {
      const input = Array.from({ length: 8 }, () => (k % 2 ? 1 + (next() % 5) : next() % 0x1000000) | 0x1000000 * 0).map((x) => x >>> 0);
      const v = await start(kind, sortWith(input));
      runToEnd(v);
      const ref = refSort(input);
      expect(screen(v, 0, 8)).toEqual(ref.sorted);
      expect(screen(v, GARBAGE, 19)).toEqual(ref.flags);
      runReverse(v);
      expect(words(v, 0, 8)).toEqual(input);
      expect(v.framebuffer().every((w) => w === 0)).toBe(true);
      v.destroy();
    }
  });

  it('shows why the garbage is needed: different inputs, same sorted output, different garbage', async () => {
    const a = await start(kind, sortWith([3, 1, 2, 4, 8, 7, 6, 5]));
    const b = await start(kind, sortWith([1, 2, 3, 4, 5, 6, 7, 8]));
    runToEnd(a);
    runToEnd(b);
    expect(screen(a, 0, 8)).toEqual(screen(b, 0, 8)); // identical sorted lists
    expect(screen(a, GARBAGE, 19)).not.toEqual(screen(b, GARBAGE, 19)); // the garbage tells them apart
    expect(screen(b, GARBAGE, 19)).toEqual(ZEROS(19)); // already sorted: nothing to record
  });

  it('shows the list changing while it runs: the compared pair leaves the screen and returns swapped', async () => {
    const v = await start(kind, source('sort.s'));
    let g = 0;
    while (v.framebuffer()[0] === 0 && g++ < 500) v.stepForward(); // entry 0 has been moved onto the screen
    expect(v.framebuffer()[0]).toBe(SORT_INPUT[0]);
    g = 0;
    while (v.framebuffer()[0] !== 0 && g++ < 500) v.stepForward(); // the first comparison picks it up
    expect(v.framebuffer()[0]).toBe(0); // its pixel goes dark...
    expect(Array.from(v.registers().regs)).toContain(SORT_INPUT[0]); // ...because it is in a register
  });

  it('reports its size and cost', async () => {
    const v = await start(kind, source('sort.s'));
    runToEnd(v);
    const r = assemble(source('sort.s'));
    const swaps = refSort(SORT_INPUT).flags.filter((f) => f !== 0).length;
    console.log(
      `sort.s ${kind}: ${r.code.length} instructions, ${v.instructionCount} steps, ${swaps} swaps, ` +
        `19 garbage pixels (information needed: log2(8!) = ${Math.log2(40320).toFixed(1)} bits), history ${v.historyBytes} bytes`,
    );
    expect(v.instructionCount).toBe(311);
  });
});
