// programs/pong.rev (the game written in rev) against programs/pong.s (the same game written by hand in assembly):
// same key events, and the screen must be identical after every frame.
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';

import { assemble } from '../../asm/src/index.js';
import { createWasmVm, type WasmVm } from '../../web/wasm/src/index.js';
import { compile } from '../src/compile.js';

const read = (p: string): string => readFileSync(new URL(`../../programs/${p}`, import.meta.url), 'utf8');
const FRAME = 0xffff;

const made: WasmVm[] = [];
afterAll(() => made.forEach((v) => v.destroy()));

async function load(image: Uint8Array, kind: 'logging' | 'reversible' = 'reversible'): Promise<WasmVm> {
  const v = await createWasmVm(kind);
  made.push(v);
  expect(v.loadProgram(image)).toBe('ok');
  return v;
}

/**
 * Run until the FRAME word reaches the next frame number (a frame is done) or the machine stops. Not "until it changes":
 * `frame += 1` on a memory cell moves the word through zero, so it changes halfway through its own update.
 */
function stepFrame(v: WasmVm): string {
  const next = v.memory(FRAME, 1)[0] + 1;
  let s: string;
  do s = v.stepForward();
  while (s === 'ok' && v.memory(FRAME, 1)[0] !== next);
  return s;
}

// The two games differ on the right half by design: pong.s lights yellow blocks, pong.rev draws a wall and the score as digits.
// The court (columns 0 to 31) must be identical pixel for pixel, which checks the whole game.
const court = (fb: Uint32Array): number[] => Array.from(fb).filter((_, i) => i % 64 < 32);
const WALL_X = 32;
const WALL = 0x606060;
const FONT: Record<number, string[]> = {
  0: ['111', '101', '101', '101', '111'], 1: ['010', '110', '010', '010', '111'], 2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '111', '001', '111'], 4: ['101', '101', '111', '001', '001'], 5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'], 7: ['111', '001', '001', '001', '001'], 8: ['111', '101', '111', '101', '111'],
  9: ['111', '101', '111', '001', '111'],
};
/** Read the digit whose top-left pixel is at (x, y), or null if the pixels are not a digit. */
function readDigit(fb: Uint32Array, x: number, y: number): number | null {
  const rows = [0, 1, 2, 3, 4].map((r) => [0, 1, 2].map((c) => (fb[(y + r) * 64 + x + c] === 0xffff00 ? '1' : fb[(y + r) * 64 + x + c] === 0 ? '0' : '?')).join(''));
  for (const [d, glyph] of Object.entries(FONT)) if (glyph.join() === rows.join()) return Number(d);
  return null;
}
const scoreOf = (fb: Uint32Array): number | null => {
  const tens = readDigit(fb, 36, 2);
  const ones = readDigit(fb, 40, 2);
  return tens === null || ones === null ? null : tens * 10 + ones;
};

const compiled = compile(read('pong.rev'));
const hand = assemble(read('pong.s'));

/** Steer the paddle toward the ball using the hand-written game's registers: returns the event to push, or null. */
function chase(ballRow: number, paddleRow: number, last: number): number | null {
  const target = Math.min(28, Math.max(0, ballRow - 1));
  const want = paddleRow < target ? 0x53 : paddleRow > target ? 0x57 : 0x153;
  return want === last ? null : want;
}

async function play(frames: number, strategy: 'chase' | 'none'): Promise<{ rev: WasmVm; asm: WasmVm; done: number; stepsRev: number; stepsAsm: number; hits: number }> {
  expect(compiled.ok, JSON.stringify(compiled.diagnostics)).toBe(true);
  expect(hand.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  const rev = await load(compiled.image!);
  const asm = await load(hand.image!);
  // run both setups to the top of the frame loop: the hand version's loop head, and the rev version's first frame boundary
  const head = hand.listing.find((r) => r.text.includes('.loop'))!.addr;
  while (asm.registers().pc !== head) asm.stepForward();
  const revLoop = compiled.assembled!.symbols.find((s) => s.name === 'start')!; // setup is straight-line; the first frame starts after it
  void revLoop;
  // the rev program's setup is its first four calls; run until the first LND of the loop head by stepping until a frame completes
  let last = 0;
  let done = 0;
  let hits = 0;
  let setupSteps = 0;
  for (let f = 0; f < frames; f++) {
    let ev: number | null = null;
    if (strategy === 'chase') {
      const ballRow = asm.registers().regs[7];
      const paddleRow = asm.registers().regs[3] >>> 27;
      ev = chase(ballRow, paddleRow, last);
    }
    if (ev !== null) {
      rev.pushInput(ev);
      asm.pushInput(ev);
      last = ev;
    }
    // hand version: until pc returns to the loop head, or it halts (game over)
    let sa: string;
    do sa = asm.stepForward();
    while (sa === 'ok' && asm.registers().pc !== head);
    // rev version: until the FRAME word changes, or it halts
    const sr = stepFrame(rev);
    if (f === 0) setupSteps = rev.instructionCount;
    void setupSteps;
    if (sa === 'halted') {
      // the hand version stops mid-frame at game over; the rev version finishes the frame and then leaves the loop
      expect(court(rev.framebuffer()), `court at game over (frame ${f + 1})`).toEqual(court(asm.framebuffer()));
      expect(sr === 'ok' || sr === 'halted').toBe(true);
      while (rev.stepForward() === 'ok') { /* the loop ends and the program halts */ }
      expect(rev.stepForward()).toBe('halted');
      return { rev, asm, done, stepsRev: rev.instructionCount, stepsAsm: asm.instructionCount, hits };
    }
    expect(sr, `rev frame ${f + 1}`).toBe('ok');
    expect(court(rev.framebuffer()), `court after frame ${f + 1}`).toEqual(court(asm.framebuffer()));
    // the wall is permanent: every pixel of column 32 is the same grey on every frame
    const fbr = rev.framebuffer();
    for (let y = 0; y < 32; y++) expect(fbr[y * 64 + WALL_X], `wall pixel row ${y}, frame ${f + 1}`).toBe(WALL);
    // the score shown as digits equals the number of hits (the hand-written game counts them as yellow blocks)
    expect(scoreOf(fbr), `score digits, frame ${f + 1}`).toBe(Array.from(asm.framebuffer()).filter((w) => w === 0xffff00).length / 4);
    done++;
    hits = Array.from(asm.framebuffer()).filter((w) => w === 0xffff00).length / 4;
  }
  return { rev, asm, done, stepsRev: rev.instructionCount, stepsAsm: asm.instructionCount, hits };
}

describe('pong.rev against pong.s', () => {
  it('compiles', () => {
    expect(compiled.ok, JSON.stringify(compiled.diagnostics)).toBe(true);
  });

  it('with no input both end on the same frame with the same picture', async () => {
    const r = await play(100, 'none');
    expect(r.done).toBe(52);
  });

  it('chasing the ball for 250 frames: identical screen after every frame, including the score blocks', async () => {
    const r = await play(250, 'chase');
    expect(r.done).toBe(250);
    expect(r.hits).toBeGreaterThanOrEqual(4);
  });

  it('rewinds exactly: stepping back to the start leaves a blank court and an empty log', async () => {
    const r = await play(60, 'chase');
    const end = Array.from(r.rev.framebuffer());
    const t = r.rev.instructionCount;
    expect(r.rev.runTo(0)).toBe('ok');
    expect(r.rev.framebuffer().every((w) => w === 0)).toBe(true);
    expect(r.rev.memory(0x1000, 128).every((w) => w === 0)).toBe(true);
    expect(r.rev.registers().regs.every((x, i) => x === (i === 14 ? 0x10000 : 0))).toBe(true);
    expect(r.rev.runTo(t)).toBe('ok');
    expect(Array.from(r.rev.framebuffer())).toEqual(end);
  });

  it('runs identically on the logging engine, which checks every assertion', async () => {
    expect(compiled.ok).toBe(true);
    const a = await load(compiled.image!, 'logging');
    const b = await load(compiled.image!, 'reversible');
    for (let f = 0; f < 80; f++) {
      if (f === 10) { a.pushInput(0x53); b.pushInput(0x53); }
      const sa = stepFrame(a);
      const sb = stepFrame(b);
      expect(sa, `logging frame ${f + 1}: ${a.lastError}`).toBe(sb);
      if (sa !== 'ok') break;
      expect(Array.from(a.framebuffer())).toEqual(Array.from(b.framebuffer()));
    }
  });

  it('reports its cost against the hand-written version', async () => {
    const r = await play(200, 'chase');
    console.log(
      `pong.rev: ${compiled.assembled!.code.length} instructions, ${(r.stepsRev / r.done).toFixed(0)} steps/frame; ` +
        `pong.s: ${hand.code.length} instructions, ${(r.stepsAsm / r.done).toFixed(0)} steps/frame`,
    );
    expect(r.done).toBe(200);
  });
});
