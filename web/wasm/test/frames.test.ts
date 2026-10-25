import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';

import { assemble } from '../../../asm/src/index.js';
import { compile } from '../../../lang/src/compile.js';
import { FRAME_WORD, FrameTracker, createWasmVm, type WasmVm } from '../src/index.js';

const read = (p: string): string => readFileSync(new URL(`../../../examples/demos/${p}`, import.meta.url), 'utf8');
const made: WasmVm[] = [];
afterAll(() => made.forEach((v) => v.destroy()));

const IMAGES: Record<string, Uint8Array> = {
  'pong.s': assemble(read('pong.s')).image!,
  'pong.rev': compile(read('pong.rev')).image!,
};

async function start(program: string, kind: 'logging' | 'reversible'): Promise<{ vm: WasmVm; frames: FrameTracker }> {
  const vm = await createWasmVm(kind);
  made.push(vm);
  expect(vm.loadProgram(IMAGES[program])).toBe('ok');
  return { vm, frames: new FrameTracker(vm) };
}

/** Everything that identifies a machine state. */
const snap = (vm: WasmVm): string =>
  [vm.instructionCount, vm.registers().pc, Array.from(vm.registers().regs).join(','), Array.from(vm.framebuffer()).join(',')].join('|');

const CASES = [
  ['pong.s', 'reversible'],
  ['pong.s', 'logging'],
  ['pong.rev', 'reversible'],
] as const;

describe.each(CASES)('FrameTracker on %s (%s engine)', (program, kind) => {
  it('steps one frame at a time, and the FRAME word equals the frame number at every boundary', async () => {
    const { vm, frames } = await start(program, kind);
    let prev = 0;
    for (let k = 1; k <= 25; k++) {
      const r = frames.stepFrame();
      expect(r.status, `frame ${k}`).toBe('ok');
      expect(r.frame).toBe(k);
      expect(vm.memory(FRAME_WORD, 1)[0]).toBe(k);
      expect(vm.instructionCount).toBeGreaterThan(prev);
      prev = vm.instructionCount;
      expect(frames.frame()).toBe(k);
      expect(frames.atBoundary()).toBe(true);
    }
    expect(frames.boundaries.length).toBe(25);
  });

  it('goes back and forth exactly: back-stepping lands on the same states as going forward did', async () => {
    const { vm, frames } = await start(program, kind);
    const seen = new Map<number, string>();
    for (let k = 1; k <= 12; k++) {
      frames.stepFrame();
      seen.set(k, snap(vm));
    }
    for (let k = 11; k >= 1; k--) {
      expect(frames.backFrame().status).toBe('ok');
      expect(frames.frame()).toBe(k);
      expect(snap(vm), `back to frame ${k}`).toBe(seen.get(k));
    }
    expect(frames.goToFrame(9).status).toBe('ok');
    expect(snap(vm)).toBe(seen.get(9));
    expect(frames.goToFrame(0).status).toBe('ok');
    expect(vm.instructionCount).toBe(0);
  });

  it('from the middle of a frame: forward finishes it, back returns to its start', async () => {
    const { vm, frames } = await start(program, kind);
    frames.goToFrame(3);
    const startOf4 = vm.instructionCount;
    for (let i = 0; i < 40; i++) vm.stepForward();
    frames.observe();
    expect(frames.frame()).toBe(3); // still inside frame 4
    expect(frames.atBoundary()).toBe(false);
    expect(frames.backFrame().status).toBe('ok');
    expect(vm.instructionCount).toBe(startOf4); // the end of frame 3
    for (let i = 0; i < 40; i++) vm.stepForward();
    expect(frames.stepFrame().frame).toBe(4);
  });

  it('knows the frame after a jump in time (a scrub), without having stepped there', async () => {
    const reference = await start(program, kind);
    for (let k = 1; k <= 15; k++) reference.frames.stepFrame();
    const target = reference.frames.boundaries[9] + 7; // 7 steps into frame 11
    const jumped = await start(program, kind);
    expect(jumped.vm.runTo(target)).toBe('ok'); // a jump: the tracker never observed these steps
    expect(jumped.frames.frame()).toBe(10);
    expect(jumped.frames.boundaries).toEqual(reference.frames.boundaries.slice(0, 10));
    expect(jumped.frames.stepFrame().frame).toBe(11);
    expect(jumped.vm.instructionCount).toBe(reference.frames.boundaries[10]);
  });

  it('a key pressed after scrubbing back starts a new timeline: truncateAfter forgets the old future', async () => {
    const { vm, frames } = await start(program, kind);
    frames.goToFrame(10);
    const oldTen = vm.instructionCount;
    frames.goToFrame(4);
    expect(vm.pushInput(0x53)).toBe('ok'); // S: moves the paddle, so the new timeline differs
    frames.truncateAfter(vm.instructionCount);
    expect(frames.boundaries.length).toBe(4);
    for (let k = 5; k <= 10; k++) expect(frames.stepFrame().frame).toBe(k);
    expect(vm.memory(FRAME_WORD, 1)[0]).toBe(10);
    expect(vm.instructionCount).toBeGreaterThan(0);
    void oldTen; // the old and new tenth frames may or may not end at the same time; what matters is that every boundary is real
    for (let k = 1; k <= 10; k++) {
      expect(frames.goToFrame(k).status).toBe('ok');
      expect(vm.memory(FRAME_WORD, 1)[0]).toBe(k);
    }
  });
});

describe('FrameTracker edge cases', () => {
  it('Pong with no input ends in game over: stepFrame reports the halt and the frames completed', async () => {
    const { frames } = await start('pong.s', 'reversible');
    let r = frames.stepFrame();
    while (r.status === 'ok') r = frames.stepFrame();
    expect(r.status).toBe('halted');
    expect(frames.frame()).toBe(52); // the 53rd frame is the one that ends the game
  });

  it('a program that never counts frames: stepFrame gives up at the limit instead of hanging', async () => {
    const vm = await createWasmVm('reversible');
    made.push(vm);
    const a = assemble('start: addi r1, 100000\n .loop ne, r2, r0\n addi r2, 1\n .again ne, r2, r1\n hlt\n');
    expect(vm.loadProgram(a.image!)).toBe('ok');
    const frames = new FrameTracker(vm);
    const r = frames.stepFrame(200);
    expect(r.status).toBe('limit');
    expect(r.steps).toBe(200);
  });

  it('reset() forgets everything after a new program is loaded', async () => {
    const { vm, frames } = await start('pong.s', 'reversible');
    frames.goToFrame(5);
    expect(vm.loadProgram(IMAGES['pong.s'])).toBe('ok');
    frames.reset();
    expect(frames.boundaries.length).toBe(0);
    expect(frames.frame()).toBe(0);
    expect(frames.stepFrame().frame).toBe(1);
  });
});
