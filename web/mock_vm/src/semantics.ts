/**
 * Reference semantics, SPEC.md section 6: forward() and backward(), over a Machine.
 * Mirrors vm/src/logging_vm.cpp (the oracle), including the strict control-flow checks of section 6 rule 4.
 * Every check happens before the first write, so a fault leaves state unchanged.
 */
import { Op, SP_REG } from '../../../spec/vm_api';
import type { Status } from '../../../spec/vm_api';
import type { Instr } from './isa';
import type { Program } from './image';
import { Machine, R_NONE } from './machine';

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

  /** forward(S): one step with d = +1. */
  forward(): Status {
    const { m, prog } = this;
    const code = prog.decoded;
    const pc = m.pc;
    const I = code[pc];
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
        const prev = m.prevKind();
        if (prev !== 0) {
          const expected = prev === 2 && m.prevPc() === I.target;
          if (cond(I.cc, m.regs[I.ra], m.regs[I.rb]) !== expected) {
            return this.fault(`LND assertion failed at pc ${pc}: arrived ${expected ? 'by' : 'not by'} the jump from ${I.target}`);
          }
        }
        m.pc = pc + 1;
        return 'ok';
      }
      case Op.BR: {
        if (!cond(I.cc, m.regs[I.ra], m.regs[I.rb])) {
          m.pc = pc + 1;
          return 'ok';
        }
        const land = code[I.target];
        if (!land) return this.fault(`BR target ${I.target} is outside the code`);
        if (land.op !== Op.LND || land.target !== pc) return this.fault(`BR target ${I.target} is not an LND naming this branch`);
        m.tookBranch = true;
        m.pc = I.target;
        return 'ok';
      }
      case Op.CALL: {
        const proc = code[I.target];
        if (!proc || proc.op !== Op.PROC) return this.fault(`CALL target ${I.target} is not a PROC`);
        const slot = m.regs[SP_REG];
        if (!m.isRam(slot)) return this.fault(`CALL: stack pointer ${hex(slot)} is outside writable memory`);
        if (m.read(slot) !== 0) return this.fault(`CALL: stack slot ${hex(slot)} above sp is not zero`);
        m.xorMem(slot, pc + 1);
        m.setReg(SP_REG, slot + 1);
        m.pc = I.target;
        return 'ok';
      }
      case Op.RET: {
        const slot = (m.regs[SP_REG] - 1) >>> 0;
        if (!m.isRam(slot)) return this.fault(`RET: stack pointer ${hex(slot + 1)} is outside writable memory`);
        const v = m.read(slot);
        if (v === 0 || v >= code.length) return this.fault(`RET to invalid address ${v}`);
        const call = code[v - 1];
        if (call.op !== Op.CALL || !code[call.target]) return this.fault(`RET to ${v}, which does not follow a CALL`);
        const proc = code[call.target];
        if (proc.op !== Op.PROC || proc.target !== pc) return this.fault(`RET at ${pc} is not the PROC's declared exit`);
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

  /** backward(S): the program run as its own inverse (d = -1), using no history. */
  backward(): Status {
    const { m, prog } = this;
    const code = prog.decoded;
    const q = m.pc;
    const I = code[q];
    if (!I) return this.fault(`pc ${q} is outside the code`);
    if (q === prog.entry) {
      this.error = `halted: reversed to the entry point (pc ${q})`;
      return 'halted';
    }
    if (I.op === Op.LND && cond(I.cc, m.regs[I.ra], m.regs[I.rb])) { // undo the jump from S
      const br = code[I.target];
      if (!br) return this.fault(`LND source ${I.target} is outside the code`);
      if (br.op !== Op.BR || br.target !== q) return this.fault('LND source is not a BR to this landing');
      m.pc = I.target;
      return 'ok';
    }
    if (I.op === Op.PROC) { // undo CALL
      const slot = (m.regs[SP_REG] - 1) >>> 0;
      if (!m.isRam(slot)) return this.fault(`undo CALL: stack pointer ${hex(slot + 1)} is outside writable memory`);
      const ret = m.read(slot);
      if (ret === 0 || ret > code.length) return this.fault(`undo CALL: bad return address ${ret} on the stack`);
      const call = code[ret - 1];
      if (call.op !== Op.CALL || call.target !== q) return this.fault('undo CALL: stacked return address does not match a CALL of this PROC');
      m.xorMem(slot, ret);
      m.setReg(SP_REG, slot);
      m.pc = ret - 1;
      return 'ok';
    }
    if (q === 0) return this.fault('no predecessor');
    const J = code[q - 1];
    if (J.op === Op.CALL) { // undo RET
      const proc = code[J.target];
      if (!proc || proc.op !== Op.PROC || proc.target >= code.length) return this.fault(`CALL target ${J.target} is not a PROC`);
      const slot = m.regs[SP_REG];
      if (!m.isRam(slot)) return this.fault(`undo RET: stack pointer ${hex(slot)} is outside writable memory`);
      if (m.read(slot) !== 0) return this.fault(`undo RET: stack slot ${hex(slot)} above sp is not zero`);
      m.xorMem(slot, q);
      m.setReg(SP_REG, slot + 1);
      m.pc = proc.target;
      return 'ok';
    }
    // J fell through
    if (J.op === Op.HLT || J.op === Op.RET || (J.op === Op.BR && J.cc === 0)) return this.fault('predecessor cannot fall through');
    const err = this.applyData(J, true); // no-op for BR, LND, NOP, PROC
    if (err) return this.fault(err);
    m.pc = q - 1;
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
        if (!m.isRam(a)) return `XST: address ${hex(a)} is ${this.readable(a) ? 'read-only' : 'unmapped'}`;
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

const hex = (a: number): string => '0x' + (a >>> 0).toString(16);
const name = (I: Instr): string => Op[I.op];
