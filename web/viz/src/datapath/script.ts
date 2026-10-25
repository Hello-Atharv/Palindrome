/**
 * What moves where when one instruction executes: a list of phases, each with the data transfers that happen at the
 * same time. ILLUSTRATIVE: the VM exposes no datapath events, so this is inferred from the decoded instruction and the
 * registers before and after the step (SPEC section 4). Pure functions, no DOM.
 *
 * A step backwards in time plays the same script of the instruction being undone, phases in reverse order and every
 * transfer from destination to source.
 */
import { Op } from '../../../../spec/vm_api';

export type NodeId =
  | 'PC' | 'INC' | 'CIR' | 'CU' | 'ALU' | 'STATUS' | 'MAR' | 'MBR' | 'MEM' | 'IN' | 'OUT'
  | `R${number}`;

export const regNode = (i: number): NodeId => `R${i}`;
export const PC_INDEX = 16;

export interface Move {
  from: NodeId;
  to: NodeId;
  /** The value that travels (shown on the packet). */
  label: string;
}

/** What becomes visible when a phase ends. */
export type Effect =
  | { kind: 'text'; node: 'MAR' | 'MBR' | 'CIR' | 'CU' | 'ALU' | 'STATUS' | 'IN' | 'OUT'; text: string }
  /** index 0..15 = r0..r15, 16 = PC. Forward playback shows `after`, reversed shows `before`. */
  | { kind: 'reg'; index: number; before: number; after: number }
  | { kind: 'code'; addr: number }
  | { kind: 'mem'; addr: number; mode: 'read' | 'write' };

export interface Phase {
  /** One plain sentence for the info box. */
  note: string;
  moves: Move[];
  effects: Effect[];
  /** Nodes to light even when nothing moves in or out of them. */
  lit?: NodeId[];
}

export interface StepState {
  /** The instruction word being executed (or undone). */
  word: number;
  /** Its code address. */
  pc: number;
  /** Where the PC is after it has executed. */
  pcAfter: number;
  /** r0..r15 before and after it executed. */
  before: ArrayLike<number>;
  after: ArrayLike<number>;
}

export interface Decoded {
  op: Op;
  ra: number;
  rb: number;
  rc: number;
  imm: number;
  immz: number;
  cc: number;
  target: number;
}

export function decodeWord(w: number): Decoded {
  const raw = w & 0x3ffff;
  return {
    op: (w >>> 26) as Op, ra: (w >>> 22) & 15, rb: (w >>> 18) & 15, rc: (w >>> 14) & 15,
    imm: (raw << 14) >> 14, immz: raw, cc: (w >>> 16) & 3, target: w & 0xffff,
  };
}

/** Short number for a packet: small values in decimal (signed), big ones in hex. */
export function short(v: number): string {
  const s = v | 0;
  return Math.abs(s) < 100000 ? String(s) : `0x${(v >>> 0).toString(16)}`;
}

const hex8 = (v: number): string => (v >>> 0).toString(16).padStart(8, '0');
const regName = (i: number): string => (i === 14 ? 'sp' : `r${i}`);

export type Region = 'data' | 'stack' | 'screen' | 'input' | 'other';
export function regionOf(addr: number): Region {
  if (addr < 0x10000) return 'data';
  if (addr < 0x20000) return 'stack';
  if (addr < 0x20800) return 'screen';
  if (addr >= 0x30000 && addr < 0x40000) return 'input';
  return 'other';
}

/** An address with the letter of its region: D14 (data), S65536 (stack), F0 (frame), I2 (input window). */
export function addrLabel(addr: number): string {
  switch (regionOf(addr)) {
    case 'data': return `D${addr}`;
    case 'stack': return `S${addr}`;
    case 'screen': return `F${addr - 0x20000}`;
    case 'input': return `I${addr - 0x30000}`;
    default: return `0x${addr.toString(16)}`;
  }
}

function holds(cc: number, a: number, b: number): boolean {
  return cc === 0 ? true : cc === 1 ? a === b : cc === 2 ? a !== b : (a | 0) < (b | 0);
}

const OPS: Partial<Record<Op, string>> = {
  [Op.ADD]: '+', [Op.SUB]: '−', [Op.XOR]: 'xor', [Op.ADDI]: '+', [Op.XORI]: 'xor', [Op.ROLI]: 'rotate left',
};

export function buildScript(s: StepState): Phase[] {
  const d = decodeWord(s.word);
  const B = s.before, A = s.after;
  const phases: Phase[] = [];

  // ---- fetch, decode (the same for every instruction): PC -> MAR -> main memory -> MBR -> CIR ----
  phases.push({
    note: `Fetch: the PC (${s.pc}) is copied to the MAR, the address register of main memory. The incrementer prepares PC + 1.`,
    moves: [{ from: 'PC', to: 'MAR', label: String(s.pc) }, { from: 'PC', to: 'INC', label: String(s.pc) }],
    effects: [{ kind: 'text', node: 'MAR', text: `P${s.pc}` }],
  });
  phases.push({
    note: `Main memory reads the program word at P${s.pc} (${mnemonic(d)}) and puts it in the MBR.`,
    moves: [{ from: 'MAR', to: 'MEM', label: `P${s.pc}` }, { from: 'MEM', to: 'MBR', label: hex8(s.word) }],
    effects: [{ kind: 'code', addr: s.pc }, { kind: 'text', node: 'MBR', text: hex8(s.word) }],
  });
  phases.push({
    note: 'The instruction word moves from the MBR to the CIR. The PC becomes PC + 1.',
    moves: [{ from: 'MBR', to: 'CIR', label: hex8(s.word) }, { from: 'INC', to: 'PC', label: String(s.pc + 1) }],
    effects: [
      { kind: 'text', node: 'CIR', text: hex8(s.word) },
      { kind: 'reg', index: PC_INDEX, before: s.pc, after: s.pc + 1 },
    ],
  });
  phases.push({
    note: 'Decode: the control unit works out what the instruction does.',
    moves: [{ from: 'CIR', to: 'CU', label: mnemonic(d) }],
    effects: [{ kind: 'text', node: 'CU', text: mnemonic(d) }],
  });

  // ---- execute ----
  const alu = (note: string, from: NodeId[], expr: string): Phase => ({
    note,
    moves: from.map((n) => ({ from: n, to: 'ALU' as NodeId, label: valueOf(n, B) })),
    effects: [{ kind: 'text', node: 'ALU', text: expr }],
  });
  const writeBack = (index: number, note: string): Phase => ({
    note,
    moves: [{ from: 'ALU', to: regNode(index), label: short(A[index]) }],
    effects: [{ kind: 'reg', index, before: B[index], after: A[index] }],
  });
  const ra = regNode(d.ra), rb = regNode(d.rb);

  switch (d.op) {
    case Op.ADD: case Op.SUB: case Op.XOR:
      phases.push(alu(`Execute: ${regName(d.ra)} and ${regName(d.rb)} go to the ALU.`, [ra, rb], `${regName(d.ra)} ${OPS[d.op]} ${regName(d.rb)}`));
      phases.push(writeBack(d.ra, `The result goes back into ${regName(d.ra)}.`));
      break;
    case Op.ADDI: case Op.XORI: case Op.ROLI: {
      const imm = d.op === Op.XORI ? d.immz : d.op === Op.ROLI ? d.imm & 31 : d.imm;
      phases.push({
        note: `Execute: ${regName(d.ra)} and the constant ${imm} (from the instruction) go to the ALU.`,
        moves: [{ from: ra, to: 'ALU', label: short(B[d.ra]) }, { from: 'CIR', to: 'ALU', label: String(imm) }],
        effects: [{ kind: 'text', node: 'ALU', text: `${regName(d.ra)} ${OPS[d.op]} ${imm}` }],
      });
      phases.push(writeBack(d.ra, `The result goes back into ${regName(d.ra)}.`));
      break;
    }
    case Op.NOT:
      phases.push(alu(`Execute: ${regName(d.ra)} goes to the ALU, which flips every bit.`, [ra], `not ${regName(d.ra)}`));
      phases.push(writeBack(d.ra, `The result goes back into ${regName(d.ra)}.`));
      break;
    case Op.SWAP:
      phases.push(alu(`Execute: ${regName(d.ra)} and ${regName(d.rb)} go to the ALU.`, [ra, rb], 'swap'));
      phases.push({
        note: `They come back the other way round: nothing is lost, so a swap is reversible.`,
        moves: [{ from: 'ALU', to: ra, label: short(A[d.ra]) }, { from: 'ALU', to: rb, label: short(A[d.rb]) }],
        effects: [
          { kind: 'reg', index: d.ra, before: B[d.ra], after: A[d.ra] },
          { kind: 'reg', index: d.rb, before: B[d.rb], after: A[d.rb] },
        ],
      });
      break;
    case Op.CSWAP: {
      const rc = regNode(d.rc);
      const swapped = B[d.rc] !== 0 && d.ra !== d.rb;
      phases.push(alu('Execute: the control register and both values go to the ALU.', [rc, ra, rb], `if ${regName(d.rc)} ≠ 0 swap`));
      phases.push(swapped
        ? {
          note: 'The control register is not zero, so the two values come back swapped.',
          moves: [{ from: 'ALU', to: ra, label: short(A[d.ra]) }, { from: 'ALU', to: rb, label: short(A[d.rb]) }],
          effects: [
            { kind: 'reg', index: d.ra, before: B[d.ra], after: A[d.ra] },
            { kind: 'reg', index: d.rb, before: B[d.rb], after: A[d.rb] },
          ],
        }
        : { note: 'The control register is zero: nothing is swapped.', moves: [], effects: [], lit: ['ALU'] });
      break;
    }
    case Op.TOFF:
      phases.push(alu('Execute: the target and both control registers go to the ALU.', [ra, rb, regNode(d.rc)], `${regName(d.ra)} xor (${regName(d.rb)} and ${regName(d.rc)})`));
      phases.push(writeBack(d.ra, `The result goes back into ${regName(d.ra)}.`));
      break;
    case Op.XLD: case Op.XST: {
      const addr = ((B[d.rb] + d.imm) >>> 0);
      const store = d.op === Op.XST;
      const value = store ? B[d.ra] : ((A[d.ra] ^ B[d.ra]) >>> 0);
      const region = regionOf(addr);
      const addrText = addrLabel(addr);
      phases.push({
        note: `Execute: the address is ${regName(d.rb)} + ${d.imm}: both go to the ALU.`,
        moves: [{ from: rb, to: 'ALU', label: short(B[d.rb]) }, { from: 'CIR', to: 'ALU', label: String(d.imm) }],
        effects: [{ kind: 'text', node: 'ALU', text: `${regName(d.rb)} + ${d.imm} = ${addrText}` }],
      });
      phases.push({
        note: `The address (${addrText}) is held in the MAR.`,
        moves: [{ from: 'ALU', to: 'MAR', label: addrText }],
        effects: [{ kind: 'text', node: 'MAR', text: addrText }],
      });
      if (store) {
        phases.push({
          note: `${regName(d.ra)} is copied into the MBR.`,
          moves: [{ from: ra, to: 'MBR', label: short(value) }],
          effects: [{ kind: 'text', node: 'MBR', text: short(value) }],
        });
        phases.push(region === 'screen'
          ? {
            note: 'The value is xor-ed into the screen memory (the output).',
            moves: [{ from: 'MBR', to: 'OUT', label: short(value) }],
            effects: [{ kind: 'text', node: 'OUT', text: `pixel ${(addr - 0x20000) % 64},${Math.floor((addr - 0x20000) / 64)}` }],
          }
          : {
            note: 'The value is xor-ed into the memory word the MAR points at (xor, never overwrite).',
            moves: [{ from: 'MAR', to: 'MEM', label: addrText }, { from: 'MBR', to: 'MEM', label: short(value) }],
            effects: [{ kind: 'mem', addr, mode: 'write' }],
          });
      } else {
        phases.push(region === 'input'
          ? {
            note: 'The address selects a word of the read-only input window.',
            moves: [{ from: 'MAR', to: 'IN', label: addrText }],
            effects: [{ kind: 'text', node: 'IN', text: `word ${addr - 0x30000}` }],
          }
          : {
            note: 'The memory word at the MAR is read.',
            moves: [{ from: 'MAR', to: 'MEM', label: addrText }],
            effects: [{ kind: 'mem', addr, mode: 'read' }],
          });
        phases.push({
          note: 'The word arrives in the MBR.',
          moves: [{ from: region === 'input' ? 'IN' : 'MEM', to: 'MBR', label: short(value) }],
          effects: [{ kind: 'text', node: 'MBR', text: short(value) }],
        });
        phases.push(alu(`${regName(d.ra)} and the MBR go to the ALU (xor, never overwrite).`, [ra, 'MBR'], `${regName(d.ra)} xor MBR`));
        phases.push(writeBack(d.ra, `The result goes back into ${regName(d.ra)}.`));
      }
      break;
    }
    case Op.BR: {
      const taken = holds(d.cc, B[d.ra], B[d.rb]);
      phases.push(alu(`Execute: ${regName(d.ra)} and ${regName(d.rb)} are compared.`, [ra, rb], `${['always', '==', '≠', '<'][d.cc]}?`));
      phases.push({
        note: taken ? 'The condition is true: the branch is taken.' : 'The condition is false: the PC stays at PC + 1.',
        moves: [{ from: 'ALU', to: 'STATUS', label: taken ? 'true' : 'false' }],
        effects: [{ kind: 'text', node: 'STATUS', text: taken ? 'true' : 'false' }],
      });
      if (taken) {
        phases.push({
          note: `The target address (${d.target}) from the instruction is loaded into the PC.`,
          moves: [{ from: 'CIR', to: 'PC', label: String(d.target) }],
          effects: [{ kind: 'reg', index: PC_INDEX, before: s.pc + 1, after: d.target }],
        });
      }
      break;
    }
    case Op.CALL: {
      const sp = B[14];
      phases.push({
        note: `Execute: the stack pointer (${short(sp)}) is the address where the return address (${s.pc + 1}) is saved.`,
        moves: [{ from: regNode(14), to: 'MAR', label: addrLabel(sp) }, { from: 'INC', to: 'MBR', label: String(s.pc + 1) }],
        effects: [{ kind: 'text', node: 'MAR', text: addrLabel(sp) }, { kind: 'text', node: 'MBR', text: String(s.pc + 1) }],
      });
      phases.push({
        note: 'The return address is written onto the stack.',
        moves: [{ from: 'MAR', to: 'MEM', label: addrLabel(sp) }, { from: 'MBR', to: 'MEM', label: String(s.pc + 1) }],
        effects: [{ kind: 'mem', addr: sp, mode: 'write' }],
      });
      phases.push(alu('The stack pointer goes up by one.', [regNode(14)], 'sp + 1'));
      phases.push(writeBack(14, 'The new stack pointer is stored.'));
      phases.push({
        note: `The procedure's address (${d.target}) is loaded into the PC.`,
        moves: [{ from: 'CIR', to: 'PC', label: String(d.target) }],
        effects: [{ kind: 'reg', index: PC_INDEX, before: s.pc + 1, after: d.target }],
      });
      break;
    }
    case Op.RET: {
      const slot = (B[14] - 1) >>> 0;
      phases.push(alu('Execute: the stack pointer goes down by one.', [regNode(14)], 'sp − 1'));
      phases.push(writeBack(14, 'The new stack pointer is stored.'));
      phases.push({
        note: 'The stack pointer addresses the saved return address.',
        moves: [{ from: regNode(14), to: 'MAR', label: addrLabel(slot) }, { from: 'MAR', to: 'MEM', label: addrLabel(slot) }],
        effects: [{ kind: 'text', node: 'MAR', text: addrLabel(slot) }, { kind: 'mem', addr: slot, mode: 'read' }],
      });
      phases.push({
        note: 'The return address is read (and the stack slot is cleared back to zero).',
        moves: [{ from: 'MEM', to: 'MBR', label: String(s.pcAfter) }],
        effects: [{ kind: 'text', node: 'MBR', text: String(s.pcAfter) }, { kind: 'mem', addr: slot, mode: 'write' }],
      });
      phases.push({
        note: 'It is loaded into the PC: execution carries on after the CALL.',
        moves: [{ from: 'MBR', to: 'PC', label: String(s.pcAfter) }],
        effects: [{ kind: 'reg', index: PC_INDEX, before: s.pc + 1, after: s.pcAfter }],
      });
      break;
    }
    case Op.LND:
      phases.push({ note: 'Landing: this instruction does nothing going forward. It only lets the machine tell, in reverse, which way it came.', moves: [], effects: [], lit: ['CU'] });
      break;
    case Op.PROC:
      phases.push({ note: 'Procedure entry marker: it does nothing, but running backwards it tells the machine where the CALL was.', moves: [], effects: [], lit: ['CU'] });
      break;
    default:
      phases.push({ note: 'No operation: nothing happens except the PC moving on.', moves: [], effects: [], lit: ['CU'] });
  }
  return phases;
}

/** The text on a packet for a node that feeds the ALU. */
function valueOf(n: NodeId, regs: ArrayLike<number>): string {
  if (n === 'MBR') return '(MBR)';
  return n.startsWith('R') ? short(regs[Number(n.slice(1))]) : '';
}

export function mnemonic(d: Decoded): string {
  const r = regName;
  switch (d.op) {
    case Op.NOP: return 'nop';
    case Op.HLT: return 'hlt';
    case Op.ADD: return `add ${r(d.ra)}, ${r(d.rb)}`;
    case Op.SUB: return `sub ${r(d.ra)}, ${r(d.rb)}`;
    case Op.ADDI: return `addi ${r(d.ra)}, ${d.imm}`;
    case Op.XOR: return `xor ${r(d.ra)}, ${r(d.rb)}`;
    case Op.XORI: return `xori ${r(d.ra)}, ${d.immz}`;
    case Op.NOT: return `not ${r(d.ra)}`;
    case Op.SWAP: return `swap ${r(d.ra)}, ${r(d.rb)}`;
    case Op.ROLI: return `roli ${r(d.ra)}, ${d.imm & 31}`;
    case Op.XLD: return `xld ${r(d.ra)}, [${r(d.rb)}${d.imm >= 0 ? '+' : ''}${d.imm}]`;
    case Op.XST: return `xst ${r(d.ra)}, [${r(d.rb)}${d.imm >= 0 ? '+' : ''}${d.imm}]`;
    case Op.CSWAP: return `cswap ${r(d.rc)}, ${r(d.ra)}, ${r(d.rb)}`;
    case Op.TOFF: return `toff ${r(d.ra)}, ${r(d.rb)}, ${r(d.rc)}`;
    case Op.BR: return `br ${['al', 'eq', 'ne', 'lt'][d.cc]}, ${d.target}`;
    case Op.LND: return `lnd ${['al', 'eq', 'ne', 'lt'][d.cc]}`;
    case Op.CALL: return `call ${d.target}`;
    case Op.PROC: return 'proc';
    case Op.RET: return 'ret';
    default: return '?';
  }
}
