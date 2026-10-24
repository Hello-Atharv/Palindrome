/** Input tape (spec/input_tape.md): timestamped events; the window is a pure function of (tape, t). */

const TAPE_MAGIC = 0x54564d52; // bytes 'R','V','M','T'

export class Tape {
  private times: number[] = [];
  private values: number[] = [];

  get length(): number {
    return this.times.length;
  }

  clear(): void {
    this.times.length = 0;
    this.values.length = 0;
  }

  /** Number of events with t_k <= t. */
  count(t: number): number {
    let lo = 0, hi = this.times.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.times[mid] <= t) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  value(k: number): number {
    return this.values[k] ?? 0;
  }

  append(t: number, value: number): void {
    this.times.push(t);
    this.values.push(value >>> 0);
  }

  /** Drop events stamped after t (a host action at t starts a new branch). */
  truncateAfter(t: number): void {
    const n = this.count(t);
    this.times.length = n;
    this.values.length = n;
  }

  /** Replace contents from a .tape file; false if malformed. */
  load(bytes: Uint8Array): boolean {
    if (bytes.byteLength < 8) return false;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (dv.getUint32(0, true) !== TAPE_MAGIC) return false;
    const n = dv.getUint32(4, true);
    if (bytes.byteLength !== 8 + n * 8) return false;
    const times: number[] = [], values: number[] = [];
    for (let k = 0; k < n; k++) {
      const t = dv.getUint32(8 + k * 8, true);
      if (k > 0 && t < times[k - 1]) return false;
      times.push(t);
      values.push(dv.getUint32(12 + k * 8, true));
    }
    this.times = times;
    this.values = values;
    return true;
  }

  serialize(): Uint8Array {
    const out = new Uint8Array(8 + this.times.length * 8);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, TAPE_MAGIC, true);
    dv.setUint32(4, this.times.length, true);
    this.times.forEach((t, k) => {
      dv.setUint32(8 + k * 8, t >>> 0, true);
      dv.setUint32(12 + k * 8, this.values[k], true);
    });
    return out;
  }
}
