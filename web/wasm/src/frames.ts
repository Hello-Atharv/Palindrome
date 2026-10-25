// Frame stepping for programs that count frames (SPEC 11.7): data word 0xFFFF starts at 0 and goes up by 1 once per frame.
//
// Why this is a class and not "run until FRAME changes": a program that updates the word by moving it through a register
// (xld, xst, add, xst, as the rev compiler and programs/demos/pong.s do) passes through ZERO halfway through its own update, so the
// value "changes" mid-frame, and when going backwards no value test can tell a frame boundary from that transient. So the tracker
// records the machine time at which each frame completed. Every jump is then exact, forwards or backwards, on either engine.
//
// Usage (the vm is any RVM, e.g. from createWasmVm):
//   const frames = new FrameTracker(vm);
//   frames.stepFrame();    // run to the end of the current frame
//   frames.backFrame();    // go back to the start of this frame, or of the previous one
//   frames.goToFrame(40);  // exact, on either engine
//   frames.frame();        // the current frame number
// Call `truncateAfter(vm.instructionCount)` after a host action that starts a new timeline (pushInput or setDirection while scrubbed
// back) and `reset()` after loadProgram.

import type { RVM, Status } from '../../../spec/vm_api.js';

export const FRAME_WORD = 0xffff;

export type FrameStop = Status | 'limit';

export interface FrameStep {
  /** `ok` means a frame boundary was reached; otherwise why it stopped (halted, fault, or limit: no frame within the step limit) */
  status: FrameStop;
  /** machine steps taken (0 when the move was a jump to an already known boundary) */
  steps: number;
  /** the frame number now */
  frame: number;
}

export class FrameTracker {
  /** Machine times at which frames 1, 2, 3... completed: `boundaries[k - 1]` is the end of frame k. */
  readonly boundaries: number[] = [];
  /** Times up to which boundaries are known (stepping forward one step at a time extends it; a jump leaves a gap). */
  private observedTo = 0;

  constructor(private readonly vm: RVM) {}

  /** Forget everything (call after loadProgram). */
  reset(): void {
    this.boundaries.length = 0;
    this.observedTo = 0;
  }

  /** Forget the future after time `t`: a new timeline starts there. */
  truncateAfter(t: number): void {
    while (this.boundaries.length && this.boundaries[this.boundaries.length - 1] > t) this.boundaries.pop();
    this.observedTo = Math.min(this.observedTo, t);
  }

  /**
   * Call after every single forward step the caller makes itself, so frames stay known without a re-scan. Returns true when that
   * step completed a frame. (stepFrame and the other methods here call it for you.)
   */
  observe(): boolean {
    const t = this.vm.instructionCount;
    if (t !== this.observedTo + 1) return false; // not contiguous: a jump happened, ensureKnown() will fill the gap
    this.observedTo = t;
    // frame k completes when the word becomes k; passing through zero or staying put never equals len + 1
    if (this.vm.memory(FRAME_WORD, 1)[0] === this.boundaries.length + 1) {
      this.boundaries.push(t);
      return true;
    }
    return false;
  }

  /** If the machine has moved past what has been observed (a scrub or jump), replay the gap once so every boundary is known. */
  private ensureKnown(): void {
    const t = this.vm.instructionCount;
    if (t <= this.observedTo) return;
    this.vm.runTo(this.observedTo);
    while (this.vm.instructionCount < t && this.vm.stepForward() === 'ok') this.observe();
  }

  /** The current frame number: how many frames have completed by now. */
  frame(): number {
    this.ensureKnown();
    const t = this.vm.instructionCount;
    let n = 0;
    while (n < this.boundaries.length && this.boundaries[n] <= t) n++;
    return n;
  }

  /** True when the machine is exactly at the end of a frame (or at the very start). */
  atBoundary(): boolean {
    this.ensureKnown();
    const t = this.vm.instructionCount;
    return t === 0 || this.boundaries.includes(t);
  }

  /** Run forward to the end of the current frame (to the next boundary). `limit` bounds the steps when no frame completes. */
  stepFrame(limit = 1_000_000): FrameStep {
    this.ensureKnown();
    const t0 = this.vm.instructionCount;
    const known = this.boundaries.find((b) => b > t0);
    if (known !== undefined) {
      const status = this.vm.runTo(known);
      return { status, steps: 0, frame: this.frame() };
    }
    for (let n = 0; n < limit; n++) {
      const s = this.vm.stepForward();
      if (s !== 'ok') return { status: s, steps: this.vm.instructionCount - t0, frame: this.frame() };
      if (this.observe()) return { status: 'ok', steps: this.vm.instructionCount - t0, frame: this.boundaries.length };
    }
    return { status: 'limit', steps: this.vm.instructionCount - t0, frame: this.frame() };
  }

  /** Go to the end of frame `k` (0 is the start of the program), stepping forward if it has not been reached yet. */
  goToFrame(k: number, limit = 1_000_000): FrameStep {
    this.ensureKnown();
    if (k <= 0) return { status: this.vm.runTo(0), steps: 0, frame: 0 };
    if (k <= this.boundaries.length) return { status: this.vm.runTo(this.boundaries[k - 1]), steps: 0, frame: k };
    let last: FrameStep = { status: 'ok', steps: 0, frame: this.frame() };
    while (this.boundaries.length < k) {
      last = this.stepFrame(limit);
      if (last.status !== 'ok') return last;
    }
    return last;
  }

  /** Go back to the start of the current frame, or to the end of the previous one if already at a boundary. */
  backFrame(): FrameStep {
    const f = this.frame();
    const t = this.vm.instructionCount;
    const atEnd = f > 0 && this.boundaries[f - 1] === t;
    const target = atEnd ? f - 1 : f; // mid-frame: the boundary behind us is frame f's end
    return this.goToFrame(target);
  }
}
