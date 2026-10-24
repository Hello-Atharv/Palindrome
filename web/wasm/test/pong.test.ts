// programs/pong.s on both real engines, compared after every frame with an independent model of the game.
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';

import { assemble } from '../../../asm/src/index.js';
import { createWasmVm, type WasmVm } from '../src/index.js';

const SOURCE = readFileSync(new URL('../../../programs/pong.s', import.meta.url), 'utf8');
const ASM = assemble(SOURCE);
const HEAD = ASM.listing.find((r) => r.text.includes('.loop'))!.addr; // the frame loop head: pc is here between frames
const FRAME_WORD = 0xffff;
const LOG = 0x1000;

const made: WasmVm[] = [];
async function start(kind: 'logging' | 'reversible'): Promise<WasmVm> {
  expect(ASM.diagnostics).toEqual([]);
  const v = await createWasmVm(kind);
  made.push(v);
  expect(v.loadProgram(ASM.image!)).toBe('ok');
  while (v.registers().pc !== HEAD) expect(v.stepForward()).toBe('ok'); // run the setup
  return v;
}
afterAll(() => made.forEach((v) => v.destroy()));

/** Run one frame: until pc returns to the loop head. Returns the last status ('ok' = frame done, 'halted' = game over). */
function stepFrame(v: WasmVm): string {
  let s: string;
  do s = v.stepForward();
  while (s === 'ok' && v.registers().pc !== HEAD);
  return s;
}

// ---- an independent model of the game ---------------------------------------------------------------------------
const STEP = 2 ** 27;
const VX = 2 ** 26;
const VY = 45 * 2 ** 20;
const WHITE = 0xffffff;
const CYAN = 0x00ffff;
const YELLOW = 0xffff00;
const fold = (phase: number): { q: number; b: number } => {
  const q = phase >>> 26;
  return { q, b: q < 32 ? q : 63 - q };
};

class PongModel {
  px = 10 * VX;
  py = 8 * VX;
  pp = 14 * STEP;
  hpos = 96; // score pixel index: row 1, column 32
  hits = 0;
  frames = 0;
  alive = true;
  screen = new Uint32Array(2048);
  constructor() {
    this.paddle();
    this.ball();
  }
  paddle(): void {
    for (let k = 0; k < 4; k++) this.screen[((((this.pp + k * STEP) >>> 0) >>> 27) * 64)] ^= CYAN;
  }
  ball(): void {
    this.screen[fold(this.py).b * 64 + fold(this.px).b] ^= WHITE;
  }
  paddleRow(): number {
    return this.pp >>> 27;
  }
  ballRow(): number {
    return fold(this.py).b;
  }
  /** One frame with `s` as the latest key event. Returns false if the ball got past the paddle (the program halts). */
  frame(s: number): boolean {
    this.paddle(); // erase
    if (s === 0x57 || s === 0x80) this.pp = (this.pp - STEP) >>> 0;
    if (s === 0x53 || s === 0x81) this.pp = (this.pp + STEP) >>> 0;
    this.paddle(); // draw
    this.ball(); // erase
    this.px = (this.px + VX) >>> 0;
    this.py = (this.py + VY) >>> 0;
    this.ball(); // draw
    if (fold(this.px).q === 63) {
      const d = ((fold(this.py).b * STEP - this.pp) >>> 0) >>> 27;
      if (d > 3) {
        this.alive = false;
        return false;
      }
      for (const o of [0, 1, 64, 65]) this.screen[this.hpos + o] ^= YELLOW; // a 2 x 2 score block
      this.hpos += 3;
      this.hits++;
    }
    this.frames++;
    return true;
  }
}

/** Steer the paddle toward the ball: returns the key event to push now, or null to keep the last one. */
function chase(m: PongModel, last: number): number | null {
  const target = Math.min(28, Math.max(0, m.ballRow() - 1));
  const p = m.paddleRow();
  const want = p < target ? 0x53 : p > target ? 0x57 : 0x153; // S, W, or a release (stop)
  return want === last ? null : want;
}

/** The temporaries (r9..r13, r15) are zero and the stack is empty: nothing hidden is left in registers. */
const clean = (v: WasmVm): boolean => {
  const r = v.registers().regs;
  return [9, 10, 11, 12, 13, 15].every((i) => r[i] === 0) && r[14] === 0x10000;
};

/** Play `frames` frames pushing events from `strategy`, comparing the machine with the model after each. */
async function play(
  kind: 'logging' | 'reversible',
  frames: number,
  strategy: (m: PongModel, last: number) => number | null,
): Promise<{ v: WasmVm; m: PongModel; events: number }> {
  const v = await start(kind);
  const m = new PongModel();
  let last = 0;
  let events = 0;
  for (let f = 0; f < frames; f++) {
    const ev = strategy(m, last);
    if (ev !== null) {
      expect(v.pushInput(ev)).toBe('ok');
      last = ev;
      events++;
    }
    const alive = m.frame(last);
    const s = stepFrame(v);
    expect(s, `frame ${f + 1}`).toBe(alive ? 'ok' : 'halted');
    expect(Array.from(v.framebuffer()), `screen after frame ${f + 1}`).toEqual(Array.from(m.screen));
    if (!alive) break;
    const regs = v.registers().regs;
    expect([regs[1], regs[2], regs[3], regs[4], regs[5], regs[6], regs[7], regs[8]], `state after frame ${f + 1}`).toEqual([
      m.px, m.py, m.pp, 0x20000 + m.hpos, 2 * m.frames, fold(m.px).b, fold(m.py).b, fold(m.px).q,
    ]);
    expect(clean(v), `temporaries zero after frame ${f + 1}`).toBe(true); // nothing hidden is left in registers
    expect(v.memory(FRAME_WORD, 1)[0]).toBe(m.frames);
    // the log holds the sample and the event count for this frame
    expect(Array.from(v.memory(LOG + 2 * (m.frames - 1), 2)), `log after frame ${f + 1}`).toEqual([last, events]);
  }
  return { v, m, events };
}

describe.each(['logging', 'reversible'] as const)('pong.s on the %s engine', (kind) => {
  it('starts with the paddle and the ball drawn', async () => {
    const v = await start(kind);
    const m = new PongModel();
    expect(Array.from(v.framebuffer())).toEqual(Array.from(m.screen));
    expect(clean(v)).toBe(true);
    const r = v.registers().regs;
    expect([r[6], r[7], r[8]]).toEqual([fold(m.px).b, fold(m.py).b, fold(m.px).q]); // the ball's position is live state
  });

  it('with no input the ball gets past the paddle on its first return: game over at frame 53', async () => {
    const { v, m } = await play(kind, 100, () => null);
    expect(m.alive).toBe(false);
    expect(m.frames).toBe(52);
    expect(v.memory(FRAME_WORD, 1)[0]).toBe(52);
    expect(v.stepForward()).toBe('halted'); // the machine has stopped
    // the model and the machine agree on exactly where it stopped
  });

  it('chasing the ball: 6 returns in a row, matching the model on every frame', async () => {
    const { m, events } = await play(kind, 400, chase);
    expect(m.alive).toBe(true);
    expect(m.hits).toBeGreaterThanOrEqual(5);
    expect(events).toBeGreaterThan(5);
  });

  it('rewinds exactly: stepping back to the start gives a blank court with only the paddle and ball', async () => {
    const { v, m } = await play(kind, 150, chase);
    const end = Array.from(v.framebuffer());
    expect(end).toEqual(Array.from(m.screen));
    const t = v.instructionCount;
    expect(v.runTo(0)).toBe('ok');
    expect(Array.from(v.framebuffer())).toEqual(Array.from(new PongModel().screen).map(() => 0)); // blank before setup
    expect(v.registers().regs.every((r, i) => r === (i === 14 ? 0x10000 : 0))).toBe(true);
    expect(v.memory(LOG, 8).every((w) => w === 0)).toBe(true); // the log is empty again
    expect(v.runTo(t)).toBe('ok'); // and forward again reproduces the game
    expect(Array.from(v.framebuffer())).toEqual(end);
  });

  it('can be scrubbed to the middle of a frame and back', async () => {
    const { v, m } = await play(kind, 60, chase);
    const end = Array.from(v.framebuffer());
    const t = v.instructionCount;
    for (const target of [t - 1, t - 37, t - 1000, 5000, Math.floor(t / 2), t]) {
      expect(v.runTo(target)).toBe('ok');
    }
    expect(Array.from(v.framebuffer())).toEqual(end);
    expect(m.hits).toBeGreaterThanOrEqual(0);
  });

  it('runs backwards from game over (direction -1), undoing the whole game when no keys were pressed', async () => {
    const { v } = await play(kind, 100, () => null);
    expect(v.setDirection(-1)).toBe('ok');
    let s;
    while ((s = v.stepForward()) === 'ok') {}
    expect(s).toBe('halted');
    expect(v.framebuffer().every((w) => w === 0)).toBe(true);
    expect(v.registers().regs.every((r, i) => r === (i === 14 ? 0x10000 : 0))).toBe(true);
    expect(v.memory(FRAME_WORD, 1)[0]).toBe(0);
  });

  it('reports its cost', async () => {
    const { v, m, events } = await play(kind, 200, chase);
    const frames = m.frames;
    console.log(
      `pong.s ${kind}: ${ASM.code.length} instructions, ${(v.instructionCount / frames).toFixed(0)} steps/frame, ` +
        `${frames} frames, ${m.hits} hits, ${events} key events; VM history ${v.historyBytes} bytes ` +
        `(${(v.historyBytes / frames).toFixed(0)} per frame); program log ${8 * frames} bytes (8 per frame)`,
    );
    expect(ASM.code.length).toBeLessThan(500);
  });
});
