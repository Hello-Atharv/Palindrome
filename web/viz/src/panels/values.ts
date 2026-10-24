import { h } from '../dom';
import { asciiOf } from './memory';
import type { Ctx, Panel } from './panel';

const MAX_WORDS = 48;

export interface Block {
  name: string;
  from: number;
  to: number;
  garbage: boolean;
}

/** The labelled data regions of a program: each data label runs to the next one, or to the end of the data section. */
export function dataBlocks(program: Ctx['program']): Block[] {
  if (!program || program.dataLen === 0) return [];
  const labels = program.dataLabels.length ? program.dataLabels : [{ name: 'data', addr: 0 }];
  return labels.map((l, i) => {
    const next = labels.slice(i + 1).find((n) => n.addr > l.addr);
    const to = next ? next.addr : program.dataLen;
    return { name: l.name, from: l.addr, to, garbage: program.garbage.some(([a]) => a === l.addr) };
  }).filter((b) => b.to > b.from);
}

/** Text if most of the bytes are printable ASCII (the cipher's message), else null. */
export function readAsText(words: ArrayLike<number>): string | null {
  const s = Array.from(words, (w) => asciiOf(w >>> 0)).join('');
  if (s.length < 4) return null;
  const printable = s.replace(/·/g, '').length;
  return printable / s.length >= 0.6 ? s.replace(/·/g, ' ').trimEnd() : null;
}

/**
 * Numbers and text the program holds in labelled data: arrays as numbers, strings as text, garbage marked. This is
 * where a program's results show up, since the machine has no console.
 */
export function valuesPanel(): Panel {
  const el = h('section', 'panel values');
  const head = h('header', 'panel-head');
  const fmtSel = h('select', 'select tiny');
  fmtSel.setAttribute('aria-label', 'number format');
  for (const f of ['decimal', 'hex'] as const) {
    const o = h('option', '', f);
    o.value = f;
    fmtSel.append(o);
  }
  head.append(h('h2', 'panel-title', 'Values'), fmtSel);
  const body = h('div', 'panel-body vals');
  el.append(head, body);

  let shown: object | null | undefined;
  let latest: Ctx | null = null;
  fmtSel.addEventListener('change', () => { if (latest) refreshValues(latest); });
  let blocks: Block[] = [];
  const cells = new Map<string, { nums: HTMLElement; text: HTMLElement }>();

  function build(program: Ctx['program']): void {
    blocks = dataBlocks(program);
    cells.clear();
    if (blocks.length === 0) {
      body.replaceChildren(h('p', 'dim', 'This program has no data section. Its results are in the registers and on the screen.'));
      return;
    }
    body.replaceChildren(
      ...blocks.map((b) => {
        const block = h('div', `val-block${b.garbage ? ' garbage' : ''}`);
        const title = h('div', 'val-head');
        title.append(h('strong', 'mono', b.name), h('span', 'dim', b.to - b.from === 1 ? `word ${b.from}` : `words ${b.from}–${b.to - 1}`));
        if (b.garbage) title.append(h('span', 'val-flag', 'garbage: kept because it cannot be erased'));
        const nums = h('div', 'val-nums mono');
        const text = h('div', 'val-text mono');
        block.append(title, text, nums); // readable text first, the raw numbers under it
        cells.set(b.name, { nums, text });
        return block;
      }),
    );
  }

  function refreshValues({ vm, program }: Ctx): void {
    if (program !== shown) {
      shown = program;
      build(program);
    }
    const asHex = fmtSel.value === 'hex';
    for (const b of blocks) {
      const n = Math.min(b.to - b.from, MAX_WORDS);
      const words = vm.memory(b.from, n);
      const c = cells.get(b.name)!;
      const more = b.to - b.from > n ? `  … ${b.to - b.from - n} more` : '';
      c.nums.textContent = Array.from(words, (w) => (asHex ? (w >>> 0).toString(16).padStart(8, '0') : String(w | 0))).join('  ') + more;
      const t = readAsText(words);
      c.text.hidden = t === null;
      c.text.textContent = t === null ? '' : `“${t}”`;
    }
  }

  return {
    el,
    update(ctx: Ctx) {
      latest = ctx;
      refreshValues(ctx);
    },
  };
}
