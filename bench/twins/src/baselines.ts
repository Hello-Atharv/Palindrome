// The rewind strategies a conventional machine has, measured on a Conv run (SPEC section 12.3).
//   tight diary          Conv.undo() with `diary` on: a real bit-packed history, rewinds exactly.
//   checkpoint + replay  keep a snapshot every K steps; to go back, restore the nearest earlier one and run forward.

import { Conv } from './conv.js';
import type { Snapshot } from './conv.js';

export class Checkpoints {
  readonly snaps: Snapshot[] = [];
  constructor(readonly K: number) {}

  /** Call before each step of the forward run (takes a snapshot when t is a multiple of K). */
  before(m: Conv): void {
    if (m.t % this.K === 0 && (this.snaps.length === 0 || this.snaps[this.snaps.length - 1].t < m.t)) {
      this.snaps.push(m.snapshot());
    }
  }

  /** Move `m` to machine time `target` (any time already reached). Returns the number of steps replayed. */
  seek(m: Conv, target: number): number {
    let best: Snapshot | undefined;
    for (const s of this.snaps) if (s.t <= target) best = s;
    if (!best) throw new Error(`no checkpoint at or before t=${target}`);
    m.restore(best);
    let replayed = 0;
    while (m.t < target) {
      if (m.step() !== 'ok') throw new Error(`replay stopped at t=${m.t}`);
      replayed++;
    }
    return replayed;
  }

  /** Bytes held: every snapshot stores the registers, the pc and every word the program ever writes. */
  bytes(writtenWords: number): number {
    return this.snaps.length * (16 + 1 + writtenWords) * 4;
  }
}

/** Worst-case replay steps to go back one step from time t with interval K. */
export const replayToPrevious = (t: number, K: number): number => (t - 1) % K;
