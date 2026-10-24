import { SP_REG } from '../../../../spec/vm_api';
import { disassemble } from '../disasm';
import { flash, h, hex } from '../dom';
import { changedRegs } from '../snapshot';
import { frame } from './panel';
import type { Ctx, Panel } from './panel';

/** Steps over which a change fades out in heat-map mode. */
const HEAT_WINDOW = 24;

/**
 * r0..r15 as tiles, plus PC and the instruction it points at. A change flashes in the colour of the time it moved
 * through (amber forward, cyan back). Above ~20 steps/s the shell switches the page to heat mode: no flash, tiles
 * glow in proportion to how recently they changed.
 */
export function registersPanel(): Panel {
  const { el, body, head } = frame('Registers', 'registers');
  const pc = h('span', 'pc-readout');
  const pcVal = h('span', 'pc-val mono');
  const pcIns = h('span', 'pc-ins mono');
  pc.append(h('span', 'dim', 'PC'), pcVal, pcIns);
  const toggle = h('div', 'toggle');
  const hexBtn = h('button', 'btn small', 'hex');
  const decBtn = h('button', 'btn small', 'dec');
  for (const b of [hexBtn, decBtn]) b.type = 'button';
  decBtn.title = 'signed decimal';
  toggle.append(hexBtn, decBtn);
  head.replaceChildren(h('h2', 'panel-title', 'Registers'), pc, toggle);

  body.classList.add('reg-grid');
  const cells = Array.from({ length: 16 }, (_, i) => {
    const cell = h('div', 'reg');
    const val = h('span', 'reg-val');
    cell.append(h('span', 'reg-name', i === SP_REG ? 'sp' : `r${i}`), val);
    body.append(cell);
    return { cell, val };
  });

  let decimal = false;
  let latest: Uint32Array | null = null;
  const lastChange = new Array<number>(16).fill(-1e9);
  const shown = new Array<number>(16).fill(-1);
  let lastT = 0;

  const paint = (): void => {
    if (!latest) return;
    latest.forEach((v, i) => {
      cells[i].val.textContent = decimal ? String(v | 0) : hex(v);
      cells[i].cell.classList.toggle('zero', v === 0);
    });
    hexBtn.setAttribute('aria-pressed', String(!decimal));
    decBtn.setAttribute('aria-pressed', String(decimal));
  };
  hexBtn.addEventListener('click', () => { decimal = false; paint(); });
  decBtn.addEventListener('click', () => { decimal = true; paint(); });

  return {
    el,
    update({ vm, snap, prev, program }: Ctx) {
      latest = snap.regs;
      const changed = changedRegs(prev, snap);
      snap.regs.forEach((v, i) => {
        if (shown[i] !== v) {
          if (shown[i] !== -1) lastChange[i] = snap.t;
          shown[i] = v;
        }
        const c = cells[i].cell;
        const isNew = changed[i] && snap.t !== lastT;
        c.classList.toggle('changed', changed[i]);
        if (isNew) flash(c, 'flash');
        c.style.setProperty('--heat', String(Math.max(0, 1 - Math.abs(snap.t - lastChange[i]) / HEAT_WINDOW)));
      });
      lastT = snap.t;
      paint();
      pcVal.textContent = String(snap.pc);
      const words = vm.code(snap.pc, 1);
      const ins = words.length && snap.pc < (program?.codeLen ?? 0) ? disassemble(words[0], program?.labels) : null;
      pcIns.textContent = ins ? `${ins.mnemonic} ${ins.operands}`.trim() : '';
    },
  };
}
