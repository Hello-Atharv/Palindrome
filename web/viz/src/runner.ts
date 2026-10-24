import type { RVM, Status } from '../../../spec/vm_api';

export type RunMode = 'forward' | 'back';

/** Speeds in steps per second; Infinity = as many as fit in the frame budget. */
export const SPEEDS = [1, 10, 100, 1_000, 10_000, 100_000, Infinity] as const;
const FRAME_BUDGET_MS = 10;
const MAX_STEPS_PER_FRAME = 200_000;

/**
 * Drives the VM from requestAnimationFrame. Many steps per frame, one UI update per frame,
 * so the screen cost is independent of the speed.
 */
export class Runner {
  speedIndex = 3;
  private mode: RunMode | null = null;
  private raf = 0;
  private last = 0;
  private carry = 0;

  constructor(
    private readonly vm: RVM,
    /** Called after each frame's batch, and once when the run stops. */
    private readonly onFrame: (status: Status, running: boolean) => void,
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

  private readonly tick = (now: number): void => {
    const mode = this.mode;
    if (mode === null) return;
    const rate = SPEEDS[this.speedIndex];
    const deadline = now + FRAME_BUDGET_MS;
    let want: number;
    if (rate === Infinity) {
      want = MAX_STEPS_PER_FRAME;
    } else {
      this.carry += (rate * (now - this.last)) / 1000;
      want = Math.min(Math.floor(this.carry), MAX_STEPS_PER_FRAME);
      this.carry -= want;
    }
    this.last = now;

    let status: Status = 'ok';
    for (let i = 0; i < want && status === 'ok'; i++) {
      status = mode === 'forward' ? this.vm.stepForward() : this.vm.stepBack();
      if ((i & 255) === 255 && performance.now() > deadline) break;
    }
    const finished = status !== 'ok';
    if (finished) this.mode = null;
    this.onFrame(status, !finished);
    if (!finished) this.raf = requestAnimationFrame(this.tick);
  };
}
