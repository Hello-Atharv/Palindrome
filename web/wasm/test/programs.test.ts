// Demo programs from programs/, assembled and run on both real engines, checked against independent
// JavaScript reference implementations of the same algorithms (and, for Speck, the published test vector).
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
  it('starts with the round keys and plaintext in memory and a black screen', async () => {
    const v = await start(kind, source('cipher.s'));
    expect(Array.from(v.memory(0, 27))).toEqual(RK); // the program's key table is the real key schedule
    expect(Array.from(v.memory(MSG, 8))).toEqual(PLAIN);
    expect(v.framebuffer().every((w) => w === 0)).toBe(true);
  });

  it('reproduces the official Speck64/128 test vector on the machine', async () => {
    const src = source('cipher.s').replace(/^msg:.*$/m, 'msg:    .word  0x3b726574, 0x7475432d, 0, 0, 0, 0, 0, 0');
    const v = await start(kind, src);
    runToEnd(v);
    expect(Array.from(v.memory(MSG, 2))).toEqual([0x8c6fa548, 0x454e028b]);
  });

  it('encrypts the message exactly like the reference, with no garbage left behind', async () => {
    const v = await start(kind, source('cipher.s'));
    runToEnd(v);
    expect(Array.from(v.memory(MSG, 8))).toEqual(CIPHER);
    expect(Array.from(v.framebuffer().subarray(0, 8))).toEqual(CIPHER); // drawn as pixels
    expect(v.framebuffer().subarray(8).every((w) => w === 0)).toBe(true);
    expect(Array.from(v.memory(0, 27))).toEqual(RK); // the key table is untouched
    const regs = Array.from(v.registers().regs);
    expect(regs.every((r, i) => r === (i === 14 ? 0x10000 : 0))).toBe(true); // every temporary is back to zero
    expect(new Set(CIPHER.map((w) => w & 0xffffff)).size).toBe(8); // all 8 pixels are different colours
  });

  it('decrypts by running the same program in reverse (direction -1)', async () => {
    const v = await start(kind, source('cipher.s'));
    runToEnd(v);
    const steps = v.instructionCount;
    expect(v.setDirection(-1)).toBe('ok');
    let s;
    while ((s = v.stepForward()) === 'ok') {}
    expect(s).toBe('halted'); // reached the start of the program, running backwards
    expect(v.instructionCount).toBe(2 * steps); // it is a real computation: time keeps moving forward
    expect(Array.from(v.memory(MSG, 8))).toEqual(PLAIN);
    expect(v.framebuffer().every((w) => w === 0)).toBe(true);
  });

  it('can be scrubbed: rewinding to the start restores the plaintext; partway shows a half-encrypted message', async () => {
    const v = await start(kind, source('cipher.s'));
    runToEnd(v);
    expect(v.runTo(0)).toBe('ok');
    expect(Array.from(v.memory(MSG, 8))).toEqual(PLAIN);
    expect(v.runTo(Math.floor(1151 / 2))).toBe('ok');
    const mid = Array.from(v.memory(MSG, 8));
    expect(mid.slice(0, 4)).toEqual(CIPHER.slice(0, 4)); // first two blocks done...
    expect(mid.slice(4)).toEqual(PLAIN.slice(4)); // ...last two not started
  });

  it('reports its size and cost', async () => {
    const v = await start(kind, source('cipher.s'));
    runToEnd(v);
    const r = assemble(source('cipher.s'));
    console.log(`cipher.s ${kind}: ${r.code.length} instructions, ${v.instructionCount} steps, history ${v.historyBytes} bytes`);
    expect(r.code.length).toBeLessThan(60);
    expect(v.instructionCount).toBe(1151);
  });
});
