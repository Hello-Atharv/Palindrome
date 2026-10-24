import type { RVM, Status } from '../../../spec/vm_api';

export type RunMode = 'forward' | 'back';

/** Speeds in steps per second; Infinity = as many as fit in the frame budget. */
export const SPEEDS = [1, 2, 5, 10, 100, 1_000, 10_000, 100_000, Infinity] as const;
/** Index of the default speed (1,000 steps/s) and of 2 steps/s (comfortable for watching data move). */
export const DEFAULT_SPEED = SPEEDS.indexOf(1_000);
export const LEARN_SPEED = SPEEDS.indexOf(2);
const FRAME_BUDGET_MS = 10;
const MAX_STEPS_PER_FRAME = 200_000;

export interface RunnerOptions {
  /**
   * Asked before every frame. 'free': run at the chosen speed. 'wait': skip this frame (an animation is still playing).
   * 'single': take exactly one step (the animation sets the pace).
   */
  gate?: () => 'free' | 'wait' | 'single';
  /** Checked after every step; true ends the run (a breakpoint was reached). */
  stopAt?: () => boolean;
}

/**
 * Drives the machines from requestAnimationFrame. Many steps per frame, one UI update per frame,
 * so the screen cost is independent of the speed. Every machine takes every step (Compare view);
 * the first machine's status decides when the run stops.
 */
export class Runner {
  speedIndex = DEFAULT_SPEED;
  private mode: RunMode | null = null;
  private raf = 0;
  private last = 0;
  private carry = 0;

  constructor(
    private readonly machines: () => readonly { vm: RVM }[],
    /** Called after each frame's batch, and once when the run stops. */
    private readonly onFrame: (status: Status, running: boolean) => void,
    private readonly options: RunnerOptions = {},
  ) {}

  get running(): boolean {
    return this.mode !== null;
  }

  get runMode(): RunMode | null {
    return this.mode;
  }

  start(mode: RunMode): void {
    this.stop();
    this.mode = mode;
    this.last = performance.now();
    this.carry = 0;
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.mode = null;
  }

  private step(mode: RunMode): Status {
    const list = this.machines();
    let first: Status = 'ok';
    list.forEach((m, i) => {
      const s = mode === 'forward' ? m.vm.stepForward() : m.vm.stepBack();
      if (i === 0) first = s;
    });
    return first;
  }

  private readonly tick = (now: number): void => {
    const mode = this.mode;
    if (mode === null) return;
    const gate = this.options.gate?.() ?? 'free';
    if (gate === 'wait') {
      this.last = now;
      this.raf = requestAnimationFrame(this.tick);
      return;
    }
    const rate = SPEEDS[this.speedIndex];
    const deadline = now + FRAME_BUDGET_MS;
    let want: number;
    if (gate === 'single') {
      want = 1;
    } else if (rate === Infinity) {
      want = MAX_STEPS_PER_FRAME;
    } else {
      this.carry += (rate * (now - this.last)) / 1000;
      want = Math.min(Math.floor(this.carry), MAX_STEPS_PER_FRAME);
      this.carry -= want;
    }
    this.last = now;

    let status: Status = 'ok';
    let hitBreakpoint = false;
    for (let i = 0; i < want && status === 'ok' && !hitBreakpoint; i++) {
      status = this.step(mode);
      if (status === 'ok' && this.options.stopAt?.()) hitBreakpoint = true;
      if ((i & 255) === 255 && performance.now() > deadline) break;
    }
    const finished = status !== 'ok' || hitBreakpoint;
    if (finished) this.mode = null;
    this.onFrame(status, !finished);
    if (!finished) this.raf = requestAnimationFrame(this.tick);
  };
}
