import type { Direction, RVM, Status } from '../../../spec/vm_api';

/** Everything the panels show, read from the VM in one go. */
export interface Snapshot {
  t: number;
  pc: number;
  regs: Uint32Array;
  direction: Direction;
  historyBytes: number;
  lastError: string;
  status: Status;
  /** 64x32 pixels, 0x00RRGGBB */
  fb: Uint32Array;
}

export function takeSnapshot(vm: RVM, status: Status): Snapshot {
  const { regs, pc } = vm.registers();
  return {
    t: vm.instructionCount,
    pc,
    regs,
    direction: vm.direction,
    historyBytes: vm.historyBytes,
    lastError: vm.lastError,
    status,
    fb: vm.framebuffer(),
  };
}

/** Which of r0..r15 differ between two snapshots. All false when there is no previous snapshot. */
export function changedRegs(prev: Snapshot | null, cur: Snapshot): boolean[] {
  return Array.from(cur.regs, (v, i) => prev !== null && prev.regs[i] !== v);
}

/** Indices where two equally long word arrays differ. */
export function changedWords(prev: Uint32Array | null, cur: Uint32Array): Set<number> {
  const out = new Set<number>();
  if (prev && prev.length === cur.length) for (let i = 0; i < cur.length; i++) if (prev[i] !== cur[i]) out.add(i);
  return out;
}
