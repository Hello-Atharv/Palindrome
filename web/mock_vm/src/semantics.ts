/**
 * Reference semantics, SPEC.md section 6: forward() and backward(), over a Machine.
 * Every check happens before the first write, so a fault leaves state unchanged.
 */
import { Op, SP_REG } from '../../../spec/vm_api';
import type { Status } from '../../../spec/vm_api';
import type { Instr } from './isa';
import type { Program } from './image';
import { Machine, R_IN, R_NONE, R_STACK } from './machine';

export class Stepper {
  /** Message for the most recent non-ok result. */
  error = '';

  constructor(private readonly m: Machine, private readonly prog: Program) {}

  private fault(msg: string): Status {
    this.error = msg;
    return 'fault';
  }

  private readable(a: number): boolean {
    return this.m.region(a) !== R_NONE;
  }

  /** CALL/RET only touch the stack region (SPEC section 5); anything else is an over/underflow. */
  private onStack(a: number): boolean {
    return this.m.region(a) === R_STACK;
  }

  private writable(a: number): boolean {
    const r = this.m.region(a);
    return r !== R_NONE && r !== R_IN;
  }

  /** forward(S): one step with d = +1. */
  forward(): Status {
    const { m, prog } = this;
    const pc = m.pc;
    const I = prog.decoded[pc];
    if (!I) return this.fault(`pc ${pc} is outside the code`);
    switch (I.op) {
      case Op.HLT:
        this.error = `halted at pc ${pc}`;
        return 'halted';
      case Op.NOP:
      case Op.PROC:
        m.pc = pc + 1;
        return 'ok';
      case Op.LND: {
        const holds = cond(I.cc, m.regs[I.ra], m.regs[I.rb]);
        const jumped = m.lastStepJumpedFrom(I.target);
        if (holds !== jumped) {
          return this.fault(`LND assertion failed at pc ${pc}: cc ${holds ? 'holds' : 'fails'} but ${jumped ? 'arrived' : 'did not arrive'} by the jump from ${I.target}`);
        }
        m.pc = pc + 1;
        return 'ok';
      }
      case Op.BR: {
        const taken = cond(I.cc, m.regs[I.ra], m.regs[I.rb]);
        m.tookBranch = taken;
        m.pc = taken ? I.target : pc + 1;
        return 'ok';
      }
      case Op.CALL: {
        const target = prog.decoded[I.target];
        if (!target || target.op !== Op.PROC) return this.fault(`CALL target ${I.target} is not a PROC`);
        const sp = m.regs[SP_REG];
        if (!this.onStack(sp)) return this.fault(`CALL: stack slot ${hex(sp)} is outside the stack`);
        m.xorMem(sp, pc + 1);
        m.setReg(SP_REG, sp + 1);
        m.pc = I.target;
        return 'ok';
      }
      case Op.RET: {
        const slot = (m.regs[SP_REG] - 1) >>> 0;
        if (!this.onStack(slot)) return this.fault(`RET: stack slot ${hex(slot)} is outside the stack (underflow?)`);
        const v = m.read(slot);
        if (v >= prog.code.length) return this.fault(`RET to ${v}, outside the code`);
        m.xorMem(slot, v);
        m.setReg(SP_REG, slot);
        m.pc = v;
        return 'ok';
      }
      default: {
        const err = this.applyData(I, false);
        if (err) return this.fault(err);
        m.pc = pc + 1;
        return 'ok';
      }
    }
  }

  /** backward(S): exact inverse of forward, using no history. Caller handles the start-of-time check. */
  backward(): Status {
    const { m, prog } = this;
    const q = m.pc;
    const I = prog.decoded[q];
    if (!I) return this.fault(`pc ${q} is outside the code`);
    if (I.op === Op.LND && cond(I.cc, m.regs[I.ra], m.regs[I.rb])) {
      m.pc = I.target; // undo the jump from S
      return 'ok';
    }
    if (I.op === Op.PROC) { // undo CALL
      const slot = (m.regs[SP_REG] - 1) >>> 0;
      if (!this.onStack(slot)) return this.fault(`undo CALL: stack slot ${hex(slot)} is outside the stack`);
      const ret = m.read(slot);
      if (ret < 1) return this.fault('undo CALL: return address is 0');
      m.xorMem(slot, ret);
      m.setReg(SP_REG, slot);
      m.pc = ret - 1;
      return 'ok';
    }
    const J = prog.decoded[q - 1];
    if (!J) return this.fault(`no predecessor of pc ${q}`);
    if (J.op === Op.CALL) { // undo RET
      const proc = prog.decoded[J.target];
      if (!proc || proc.op !== Op.PROC) return this.fault(`CALL target ${J.target} is not a PROC`);
      const sp = m.regs[SP_REG];
      if (!this.onStack(sp)) return this.fault(`undo RET: stack slot ${hex(sp)} is outside the stack`);
      m.xorMem(sp, q);
      m.setReg(SP_REG, sp + 1);
      m.pc = proc.target;
      return 'ok';
    }
    if (J.op === Op.RET) return this.fault(`pc ${q} follows a RET but not a CALL`);
    const err = this.applyData(J, true);
    if (err) return this.fault(err);
    m.pc = q - 1; // J fell through (BR/LND/NOP/PROC/HLT: no data change)
    return 'ok';
  }

  /** Apply (or invert) the data effect of `I`. Returns an error message, or '' on success. */
  private applyData(I: Instr, inverse: boolean): string {
    const { m } = this;
    const R = m.regs;
    const { ra, rb } = I;
    switch (I.op) {
      case Op.ADD:
      case Op.SUB: {
        if (ra === rb) return `${name(I)} needs ra != rb`;
        const sub = (I.op === Op.SUB) !== inverse;
        m.setReg(ra, sub ? R[ra] - R[rb] : R[ra] + R[rb]);
        return '';
      }
      case Op.ADDI:
        m.setReg(ra, inverse ? R[ra] - I.imm : R[ra] + I.imm);
        return '';
      case Op.XOR:
        if (ra === rb) return 'XOR needs ra != rb';
        m.setReg(ra, R[ra] ^ R[rb]);
        return '';
      case Op.XORI:
        m.setReg(ra, R[ra] ^ I.immz);
        return '';
      case Op.NOT:
        m.setReg(ra, ~R[ra]);
        return '';
      case Op.SWAP: {
        const a = R[ra], b = R[rb];
        m.setReg(ra, b);
        m.setReg(rb, a);
        return '';
      }
      case Op.ROLI: {
        const k = inverse ? (32 - (I.imm & 31)) & 31 : I.imm & 31;
        m.setReg(ra, k === 0 ? R[ra] : (R[ra] << k) | (R[ra] >>> (32 - k)));
        return '';
      }
      case Op.XLD: {
        if (ra === rb) return 'XLD needs ra != rb';
        const a = (R[rb] + I.imm) >>> 0;
        if (!this.readable(a)) return `XLD: address ${hex(a)} is unmapped`;
        m.setReg(ra, R[ra] ^ m.read(a));
        return '';
      }
      case Op.XST: {
        const a = (R[rb] + I.imm) >>> 0;
        if (!this.writable(a)) return `XST: address ${hex(a)} is ${this.readable(a) ? 'read-only' : 'unmapped'}`;
        m.xorMem(a, R[ra]);
        return '';
      }
      case Op.CSWAP: {
        const { rc } = I;
        if (rc === ra || rc === rb) return 'CSWAP needs rc not in {ra, rb}';
        if (R[rc] !== 0) {
          const a = R[ra], b = R[rb];
          m.setReg(ra, b);
          m.setReg(rb, a);
        }
        return '';
      }
      case Op.TOFF: {
        const { rc } = I;
        if (ra === rb || ra === rc) return 'TOFF needs ra not in {rb, rc}';
        m.setReg(ra, R[ra] ^ (R[rb] & R[rc]));
        return '';
      }
      default:
        return ''; // NOP, HLT, PROC, BR, LND: no data effect
    }
  }
}

/** cc: 0 al, 1 eq, 2 ne, 3 lt (signed). */
export function cond(cc: number, a: number, b: number): boolean {
  switch (cc) {
    case 0: return true;
    case 1: return a === b;
    case 2: return a !== b;
    default: return (a | 0) < (b | 0);
  }
}

const hex = (a: number): string => '0x' + a.toString(16);
const name = (I: Instr): string => Op[I.op];
