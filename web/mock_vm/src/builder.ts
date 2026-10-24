/** A tiny label-resolving program builder for tests and demos. The real assembler lives in asm/. */
import { COND, Op } from '../../../spec/vm_api';
import { buildImage } from './image';
import type { Symbol } from './image';
import { encode } from './isa';
import type { InstrFields } from './isa';

type Cond = (typeof COND)[number];
type Label = string;

export interface Built {
  image: Uint8Array;
  code: number[];
  entry: number;
  labels: Map<string, number>;
}

export class ProgramBuilder {
  private readonly items: (() => InstrFields)[] = [];
  private readonly labels = new Map<Label, number>();

  /** Address of the next instruction. */
  get here(): number {
    return this.items.length;
  }

  label(name: Label): this {
    if (this.labels.has(name)) throw new Error(`duplicate label ${name}`);
    this.labels.set(name, this.items.length);
    return this;
  }

  private emit(f: InstrFields | (() => InstrFields)): this {
    this.items.push(typeof f === 'function' ? f : () => f);
    return this;
  }

  private addr(l: Label): number {
    const a = this.labels.get(l);
    if (a === undefined) throw new Error(`undefined label ${l}`);
    return a;
  }

  nop = () => this.emit({ op: Op.NOP });
  hlt = () => this.emit({ op: Op.HLT });
  add = (ra: number, rb: number) => this.emit({ op: Op.ADD, ra, rb });
  sub = (ra: number, rb: number) => this.emit({ op: Op.SUB, ra, rb });
  addi = (ra: number, imm: number) => this.emit({ op: Op.ADDI, ra, imm });
  xor = (ra: number, rb: number) => this.emit({ op: Op.XOR, ra, rb });
  xori = (ra: number, imm: number) => this.emit({ op: Op.XORI, ra, imm });
  not = (ra: number) => this.emit({ op: Op.NOT, ra });
  swap = (ra: number, rb: number) => this.emit({ op: Op.SWAP, ra, rb });
  roli = (ra: number, imm: number) => this.emit({ op: Op.ROLI, ra, imm });
  xld = (ra: number, rb: number, imm = 0) => this.emit({ op: Op.XLD, ra, rb, imm });
  xst = (ra: number, rb: number, imm = 0) => this.emit({ op: Op.XST, ra, rb, imm });
  /** cswap rc, ra, rb */
  cswap = (rc: number, ra: number, rb: number) => this.emit({ op: Op.CSWAP, ra, rb, rc });
  /** toff ra, rb, rc */
  toff = (ra: number, rb: number, rc: number) => this.emit({ op: Op.TOFF, ra, rb, rc });
  ret = () => this.emit({ op: Op.RET });

  br(cc: Cond, ra: number, rb: number, to: Label): this {
    return this.emit(() => ({ op: Op.BR, cc: COND.indexOf(cc), ra, rb, target: this.addr(to) }));
  }

  /** lnd cc, ra, rb, S where S is the label of the BR that jumps here. */
  lnd(cc: Cond, ra: number, rb: number, from: Label): this {
    return this.emit(() => ({ op: Op.LND, cc: COND.indexOf(cc), ra, rb, target: this.addr(from) }));
  }

  call(to: Label): this {
    return this.emit(() => ({ op: Op.CALL, target: this.addr(to) }));
  }

  /** proc E where E labels the matching RET. */
  proc(end: Label): this {
    return this.emit(() => ({ op: Op.PROC, target: this.addr(end) }));
  }

  build(data: number[] = []): Built {
    const code = this.items.map((f) => encode(f()));
    const entry = this.labels.get('start') ?? 0;
    const symbols: Symbol[] = [...this.labels].map(([name, addr]) => ({ addr, kind: 0, name }));
    return { image: buildImage({ entry, code, data, symbols }), code, entry, labels: new Map(this.labels) };
  }
}
