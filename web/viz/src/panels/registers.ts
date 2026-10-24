import { SP_REG } from '../../../../spec/vm_api';
import { flash, h, hex } from '../dom';
import { changedRegs } from '../snapshot';
import { frame } from './panel';
import type { Ctx, Panel } from './panel';

/** r0..r15 in a 4x4 grid; registers changed by the latest step flash. */
export function registersPanel(): Panel {
  const { el, body } = frame('Registers', 'registers');
  body.classList.add('reg-grid');
  const cells = Array.from({ length: 16 }, (_, i) => {
    const cell = h('div', 'reg');
    const name = h('span', 'reg-name', i === SP_REG ? 'sp' : `r${i}`);
    const val = h('span', 'reg-val');
    const dec = h('span', 'reg-dec');
    cell.append(name, val, dec);
    body.append(cell);
    return { cell, val, dec };
  });
  const shown = new Array<number>(16).fill(-1);

  return {
    el,
    update({ snap, prev }: Ctx) {
      const changed = changedRegs(prev, snap);
      snap.regs.forEach((v, i) => {
        const c = cells[i];
        if (shown[i] !== v) {
          shown[i] = v;
          c.val.textContent = hex(v);
          c.dec.textContent = String(v | 0);
        }
        c.cell.classList.toggle('zero', v === 0);
        c.cell.classList.toggle('changed', changed[i]);
        if (changed[i]) flash(c.cell, 'flash');
      });
    },
  };
}
