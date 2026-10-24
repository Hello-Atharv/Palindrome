import type { AsmOutcome } from '../assembler';
import { h } from '../dom';
import type { ProgramEntry } from '../program';
import type { Ctx, Panel } from './panel';

/**
 * The Code view's built-in editor: source in, Assemble & load, diagnostics out. It is a stand-in until the debugger
 * mounts a real editor into `slots.code` (then this one hides). It never assembles itself: `onAssemble` is the hook.
 */
export function codePanel(
  samples: readonly ProgramEntry[],
  onAssemble: (source: string, name: string) => AsmOutcome,
  onPick: (i: number) => void,
): Panel {
  const el = h('section', 'code-builtin');
  const bar = h('div', 'code-bar');
  const pick = h('select', 'select');
  pick.setAttribute('aria-label', 'program source');
  samples.forEach((p, i) => {
    if (p.source === undefined) return;
    const o = h('option', '', p.name);
    o.value = String(i);
    pick.append(o);
  });
  const run = h('button', 'btn primary', 'Assemble & load');
  run.type = 'button';
  run.title = 'Assemble the source and load it into the machine (resets to t = 0)';
  const summary = h('span', 'code-summary dim', 'not assembled yet');
  bar.append(pick, run, summary);

  const editor = h('textarea', 'code-editor mono');
  editor.spellcheck = false;
  editor.setAttribute('aria-label', 'assembly source');
  const diag = h('ul', 'diag-list mono');
  const listingBox = h('div', 'asm-listing mono');
  el.append(bar, editor, diag, listingBox);

  let shown: object | null = null;
  let name = 'edited';

  const assemble = (): void => {
    const out = onAssemble(editor.value, name);
    summary.textContent = out.ok ? `assembled: ${out.listing.length} instructions` : 'assembler errors';
    summary.dataset.state = out.ok ? 'ok' : 'error';
    diag.replaceChildren(
      ...out.diagnostics.map((d) => {
        const li = h('li', `diag ${d.severity}`, `${d.line > 0 ? `line ${d.line}: ` : ''}${d.severity}: ${d.message}`);
        if (d.line > 0) {
          li.tabIndex = 0;
          li.title = 'select this line';
          li.addEventListener('click', () => selectLine(d.line));
        }
        return li;
      }),
    );
    listingBox.textContent = out.listing.slice(0, 200).map((r) => `${String(r.addr).padStart(4)}  ${r.word.toString(16).padStart(8, '0')}  ${r.text.trim()}`).join('\n');
  };

  function selectLine(line: number): void {
    const lines = editor.value.split('\n');
    const start = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
    editor.focus();
    editor.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0));
  }

  run.addEventListener('click', assemble);
  editor.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      assemble();
    }
  });
  pick.addEventListener('change', () => onPick(Number(pick.value)));

  return {
    el,
    update({ program }: Ctx) {
      if (program === shown) return;
      shown = program;
      if (program?.source !== undefined) {
        editor.value = program.source;
        name = program.name;
        const idx = samples.findIndex((s) => s.name === program.name);
        if (idx >= 0) pick.value = String(idx);
      }
    },
  };
}
