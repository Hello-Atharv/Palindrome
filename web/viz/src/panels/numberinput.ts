import { IN_COUNT, IN_EVENTS } from '../../../../spec/vm_api';
import { h } from '../dom';
import type { Ctx, Panel } from './panel';

const SHOW = 6;

/** Parse a decimal or 0x-hex integer that fits in 32 bits (negative numbers are two's complement). */
export function parseNumber(text: string): number | null {
  const t = text.trim();
  if (!/^-?(?:0x[0-9a-f]+|\d+)$/i.test(t)) return null;
  const n = Number(t.startsWith('-') ? `-${t.slice(1)}` : t);
  if (!Number.isInteger(n) || n < -(2 ** 31) || n > 2 ** 32 - 1) return null;
  return n >>> 0;
}

/**
 * "Send a number to the machine": puts one number on the input tape at the current t. The program reads it from the
 * input window (XLD from 0x30002 + k); the machine cannot see a number sent after the step that reads it, so send the
 * numbers before stepping. Shows what the window holds at this t.
 */
export function numberInputPanel(onSend: (value: number) => void): Panel {
  const el = h('form', 'numin');
  const label = h('label', 'numin-label', 'Send a number');
  const field = h('input', 'numin-field mono');
  field.type = 'text';
  field.inputMode = 'numeric';
  field.placeholder = 'e.g. 7';
  field.autocomplete = 'off';
  field.setAttribute('aria-label', 'number to send to the machine');
  const send = h('button', 'btn small', 'Send');
  send.type = 'submit';
  const seen = h('span', 'numin-seen dim');
  const error = h('span', 'numin-error');
  error.hidden = true;
  label.append(field);
  el.append(label, send, seen, error);

  el.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const n = parseNumber(field.value);
    error.hidden = n !== null;
    if (n === null) {
      error.textContent = 'Enter a whole number, in decimal or as 0x… hex.';
      return;
    }
    onSend(n);
    field.value = '';
    field.focus();
  });

  return {
    el,
    update({ vm }: Ctx) {
      const count = vm.memory(IN_COUNT, 1)[0];
      const values = count > 0 ? Array.from(vm.memory(IN_EVENTS, Math.min(count, SHOW)), (v) => String(v | 0)) : [];
      seen.textContent = count === 0
        ? 'The input window is empty at this time.'
        : `The program can see ${count === 1 ? 'one number' : `${count} numbers`}: ${values.join(', ')}${count > SHOW ? ', …' : ''}`;
    },
  };
}
