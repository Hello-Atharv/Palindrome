import { Op } from '../../../../spec/vm_api';
import { disassemble } from '../disasm';
import { h, hex } from '../dom';
import { frame } from './panel';
import type { Ctx, Panel } from './panel';

const ROWS = 13;
const BEFORE = 6;

const KIND: Partial<Record<Op, string>> = {
  [Op.BR]: 'flow', [Op.LND]: 'flow', [Op.CALL]: 'flow', [Op.PROC]: 'flow', [Op.RET]: 'flow',
  [Op.HLT]: 'halt', [Op.NOP]: 'nop',
  [Op.XLD]: 'mem', [Op.XST]: 'mem',
};

/** PC, the current instruction, and a disassembly window around it (labels from the symbol table). */
export function cpuPanel(): Panel {
  const { el, body, head } = frame('CPU', 'cpu');
  const pcBadge = h('span', 'badge mono');
  head.append(pcBadge);
  const rows = Array.from({ length: ROWS }, () => {
    const row = h('div', 'dis-row');
    const addr = h('span', 'dis-addr');
    const word = h('span', 'dis-word');
    const label = h('span', 'dis-label');
    const mn = h('span', 'dis-mn');
    const ops = h('span', 'dis-ops');
    row.append(addr, word, label, mn, ops);
    body.append(row);
    return { row, addr, word, label, mn, ops };
  });

  return {
    el,
    update({ vm, snap, program }: Ctx) {
      pcBadge.textContent = `pc ${snap.pc}  (0x${snap.pc.toString(16)})`;
      const codeLen = program?.codeLen ?? 0;
      const start = Math.max(0, snap.pc - BEFORE);
      const words = vm.code(start, ROWS);
      rows.forEach((r, i) => {
        const a = start + i;
        const visible = a < codeLen;
        r.row.hidden = !visible;
        if (!visible) return;
        const w = words[i];
        const d = disassemble(w, program?.labels);
        r.row.classList.toggle('current', a === snap.pc);
        r.addr.textContent = String(a).padStart(4, ' ');
        r.word.textContent = hex(w);
        r.label.textContent = program?.labels.get(a) ?? '';
        r.mn.textContent = d.mnemonic;
        r.mn.dataset.kind = KIND[(w >>> 26) as Op] ?? 'alu';
        r.ops.textContent = d.operands;
      });
    },
  };
}
