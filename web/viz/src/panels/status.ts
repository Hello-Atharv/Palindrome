import { h, formatBytes } from '../dom';
import { frame } from './panel';
import type { Ctx, Panel } from './panel';

/** t, direction, history cost, VM kind and the last error/status. */
export function statusPanel(): Panel {
  const { el, body } = frame('Time', 'status');
  const row = (label: string): HTMLElement => {
    const r = h('div', 'kv');
    const v = h('span', 'kv-val mono');
    r.append(h('span', 'kv-key', label), v);
    body.append(r);
    return v;
  };
  const t = row('instruction count t');
  const dir = row('direction');
  const hist = row('history');
  const per = row('history / step');
  const kind = row('engine');
  const banner = h('div', 'banner');
  body.append(banner);

  return {
    el,
    update({ vm, snap }: Ctx) {
      t.textContent = snap.t.toLocaleString('en-GB');
      dir.textContent = snap.direction === 1 ? '▶ forward (+1)' : '◀ reverse (−1)';
      hist.textContent = formatBytes(snap.historyBytes);
      per.textContent = snap.t > 0 ? `${(snap.historyBytes / snap.t).toFixed(1)} B` : '–';
      kind.textContent = vm.kind;
      const level = snap.status === 'ok' ? (snap.lastError ? 'note' : 'ok') : snap.status === 'fault' ? 'fault' : 'note';
      banner.dataset.level = level;
      banner.textContent = snap.lastError || (snap.status === 'ok' ? 'ok' : snap.status);
    },
  };
}
