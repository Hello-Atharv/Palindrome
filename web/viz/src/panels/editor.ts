import type { AsmOutcome } from '../assembler';
import { disassemble } from '../disasm';
import { h } from '../dom';
import { tokenize } from '../highlight';
import type { Language } from '../highlight';
import { icon } from '../icons';
import type { Ctx, Panel } from './panel';
import { checkRev, costReport } from '../revtools';
import type { RevDiagnostic } from '../revtools';

const LINE_H = 20;

export interface LineClick {
  /** Code address of the clicked line. */
  addr: number;
  /** True if the click landed in the breakpoint gutter. */
  gutter: boolean;
  shiftKey: boolean;
}

/** What the debugger can do with the editor. The editor never decides what a click means. */
export interface ListingApi {
  /** Called for every click on a line that holds an instruction. Returns an unsubscribe function. */
  onLineClick(fn: (e: LineClick) => void): () => void;
  /** Draw a breakpoint dot in the gutter of exactly these code addresses. */
  setBreakpoints(addrs: readonly number[]): void;
  /** Highlight one "culprit" line (for example the instruction that last wrote a watched value); null clears it. */
  setCulprit(addr: number | null): void;
  /** Scroll so this address is in view (turns off follow-PC until the PC moves again). */
  scrollTo(addr: number): void;
  /** Keep the current line in view as the PC moves (default true). */
  followPc: boolean;
}

export interface EditorHooks {
  /** Assemble the text and load it. */
  onAssemble(source: string, name: string): AsmOutcome;
  /** The text changed (every keystroke). The shell keeps it as a draft. */
  onEdit?(source: string, name: string): void;
  /** False when no assembler was given: the text is then read-only and there is no Build button. */
  canBuild: boolean;
}

export type EditorPanel = Panel & {
  /** The header row (file name, Follow, Build and load): the shell adds the .s / .rev switch at its right end. */
  tab: HTMLElement;
  api: ListingApi;
  /** The shell's own click handler, used only while nobody else listens (it toggles breakpoints). */
  onDefaultClick(fn: (e: LineClick) => void): void;
  /** How many outside listeners are subscribed. */
  readonly outsideListeners: number;
};

/**
 * The code editor: assembly source (editable, with Build) or, for a program without source, its disassembly. A gutter
 * with line numbers and breakpoint dots, the current instruction highlighted, a culprit line, assembler problems below.
 */
export function editorPanel(hooks: EditorHooks): EditorPanel {
  const el = h('section', 'editor');
  el.setAttribute('aria-label', 'code editor');

  const tab = h('div', 'ed-tab');
  const fileName = h('span', 'ed-file', 'no program');
  const dirty = h('span', 'ed-dirty');
  dirty.title = 'Changed since it was last built';
  dirty.hidden = true;
  const follow = h('label', 'ed-follow');
  const followBox = h('input');
  followBox.type = 'checkbox';
  followBox.checked = true;
  follow.append(followBox, h('span', '', 'Follow'));
  follow.title = 'Keep the current instruction in view';
  const build = h('button', 'btn primary ed-build');
  build.type = 'button';
  build.title = 'Assemble the source and load it (resets to t = 0). Ctrl+Enter';
  build.setAttribute('aria-label', 'Build and load');
  build.append(icon('build'), h('span', '', 'Build and load'));
  tab.append(fileName, dirty, h('span', 'grow'), follow);
  if (hooks.canBuild) tab.append(build);

  const scroll = h('div', 'ed-scroll');
  const inner = h('div', 'ed-inner');
  const gutter = h('div', 'ed-gutter');
  const body = h('div', 'ed-body');
  const cur = h('div', 'ed-cur');
  const culpritBar = h('div', 'ed-culprit');
  const syn = h('pre', 'ed-syn mono'); // the coloured copy of the text, drawn behind the transparent textarea
  syn.setAttribute('aria-hidden', 'true');
  const text = h('textarea', 'ed-text mono');
  text.spellcheck = false;
  text.setAttribute('wrap', 'off');
  text.setAttribute('aria-label', 'assembly source');
  body.append(cur, culpritBar, syn, text);
  inner.append(gutter, body);
  scroll.append(inner);

  const problems = h('ul', 'ed-problems mono');
  problems.hidden = true;
  const report = h('pre', 'ed-report mono'); // rev only: the per-line cost report, filled after Build
  report.hidden = true;
  report.setAttribute('aria-label', 'cost report');
  el.append(tab, scroll, problems, report);

  let program: object | null | undefined;
  let name = 'program';
  let language: Language = 'asm';
  let addrOfLine = new Map<number, number>();
  let lineOfAddr = new Map<number, number>();
  let breakpoints = new Set<number>();
  let culpritAddr: number | null = null;
  let errorLines = new Set<number>();
  let pcLine = -1;
  let lastT = -1;
  let lines = 0;
  const outside = new Set<(e: LineClick) => void>();
  let fallback: ((e: LineClick) => void) | null = null;

  const fire = (e: LineClick): void => {
    if (outside.size) outside.forEach((fn) => fn(e));
    else fallback?.(e);
  };

  function paintGutter(): void {
    const rows: HTMLElement[] = [];
    for (let n = 1; n <= lines; n++) {
      const row = h('div', 'ed-ln');
      row.dataset.line = String(n);
      const addr = addrOfLine.get(n);
      row.classList.toggle('code', addr !== undefined);
      row.classList.toggle('bp', addr !== undefined && breakpoints.has(addr));
      row.classList.toggle('err', errorLines.has(n));
      row.classList.toggle('now', n === pcLine);
      row.append(h('span', 'ed-dot'), h('span', 'ed-num mono', String(n)));
      rows.push(row);
    }
    gutter.replaceChildren(...rows);
  }

  function paintMarks(): void {
    // unbuilt edits make the line numbers stale, so the marker waits for the next build
    const stale = !dirty.hidden;
    cur.hidden = pcLine < 1 || stale;
    cur.style.top = `${(pcLine - 1) * LINE_H}px`;
    const cl = culpritAddr === null ? undefined : lineOfAddr.get(culpritAddr);
    culpritBar.hidden = cl === undefined;
    if (cl !== undefined) culpritBar.style.top = `${(cl - 1) * LINE_H}px`;
    gutter.querySelectorAll('.ed-ln').forEach((row, i) => {
      const n = i + 1;
      const addr = addrOfLine.get(n);
      row.classList.toggle('bp', addr !== undefined && breakpoints.has(addr));
      row.classList.toggle('now', n === pcLine);
    });
  }

  function paintSyntax(): void {
    const nodes: Node[] = [];
    tokenize(text.value, language).forEach((tokens, i, all) => {
      for (const t of tokens) {
        if (t.kind === 'plain') nodes.push(document.createTextNode(t.text));
        else nodes.push(h('span', `tok-${t.kind}`, t.text));
      }
      if (i < all.length - 1) nodes.push(document.createTextNode('\n'));
    });
    syn.replaceChildren(...nodes);
  }

  function size(): void {
    const content = text.value.split('\n');
    lines = content.length;
    text.style.height = `${lines * LINE_H + 8}px`;
    const longest = content.reduce((m, l) => Math.max(m, l.length), 0);
    text.style.width = `${Math.max(longest + 6, 40)}ch`;
    inner.style.height = `${lines * LINE_H + 8}px`;
    paintSyntax();
  }

  function setContent(value: string, editable: boolean): void {
    text.value = value;
    text.readOnly = !editable;
    dirty.hidden = true;
    errorLines = new Set();
    problems.hidden = true;
    report.hidden = true;
    size();
    paintGutter();
  }

  function reveal(line: number, centre: boolean): void {
    const top = (line - 1) * LINE_H;
    const view = scroll.clientHeight || 10 * LINE_H;
    if (centre || top < scroll.scrollTop + LINE_H || top > scroll.scrollTop + view - 3 * LINE_H) {
      scroll.scrollTop = Math.max(0, top - view / 2);
    }
  }

  function showProblems(diagnostics: readonly RevDiagnostic[]): void {
    errorLines = new Set(diagnostics.filter((d) => d.severity === 'error' && d.line > 0).map((d) => d.line));
    problems.replaceChildren(
      ...diagnostics.map((d) => {
        const li = h('li', `prob ${d.severity}`);
        li.append(icon(d.severity === 'error' ? 'cross' : 'warn', 14), h('span', '', `${d.line > 0 ? `Line ${d.line}: ` : ''}${d.message}`));
        if (d.line > 0) {
          li.tabIndex = 0;
          li.title = 'Go to this line';
          li.addEventListener('click', () => selectLine(d.line));
        }
        return li;
      }),
    );
    problems.hidden = diagnostics.length === 0;
    paintGutter();
  }

  const buildNow = (): void => {
    const out = hooks.onAssemble(text.value, name);
    showProblems(out.diagnostics);
    if (out.ok) dirty.hidden = true;
    report.hidden = true;
    if (out.ok && language === 'rev') {
      const built = text.value;
      void costReport(built, fileName.textContent ?? 'program.rev').then((txt) => {
        if (text.value !== built) return; // edited since: the numbers would be for other code
        report.textContent = txt;
        report.hidden = txt === '';
      });
    }
  };

  // rev: check the text shortly after typing stops (compile only, nothing is loaded)
  let liveTimer: ReturnType<typeof setTimeout> | undefined;
  const liveCheck = (): void => {
    clearTimeout(liveTimer);
    if (language !== 'rev') return;
    liveTimer = setTimeout(() => showProblems(checkRev(text.value)), 300);
  };

  function selectLine(line: number): void {
    const all = text.value.split('\n');
    const start = all.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
    text.focus();
    text.setSelectionRange(start, start + (all[line - 1]?.length ?? 0));
    reveal(line, true);
  }

  build.addEventListener('click', buildNow);
  text.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey) && hooks.canBuild) {
      ev.preventDefault();
      buildNow();
    }
  });
  text.addEventListener('input', () => {
    dirty.hidden = false;
    report.hidden = true; // its numbers belong to the code that was built
    size();
    paintGutter();
    hooks.onEdit?.(text.value, name);
    liveCheck();
  });

  gutter.addEventListener('click', (ev) => {
    const row = (ev.target as HTMLElement).closest<HTMLElement>('.ed-ln');
    const addr = row ? addrOfLine.get(Number(row.dataset.line)) : undefined;
    if (addr !== undefined) fire({ addr, gutter: true, shiftKey: ev.shiftKey });
  });
  text.addEventListener('click', (ev) => {
    const line = text.value.slice(0, text.selectionStart).split('\n').length;
    const addr = addrOfLine.get(line);
    if (addr !== undefined) fire({ addr, gutter: false, shiftKey: ev.shiftKey });
  });

  const api: ListingApi = {
    onLineClick(fn) {
      outside.add(fn);
      return () => void outside.delete(fn);
    },
    setBreakpoints(addrs) {
      breakpoints = new Set(addrs);
      paintMarks();
    },
    setCulprit(addr) {
      culpritAddr = addr;
      paintMarks();
    },
    scrollTo(addr) {
      followBox.checked = false;
      const l = lineOfAddr.get(addr);
      if (l !== undefined) reveal(l, true);
    },
    get followPc() { return followBox.checked; },
    set followPc(on: boolean) { followBox.checked = on; },
  };

  return {
    el,
    tab,
    api,
    onDefaultClick(fn) { fallback = fn; },
    get outsideListeners() { return outside.size; },
    update({ vm, snap, program: info }: Ctx) {
      if (info !== program) {
        program = info;
        addrOfLine = new Map();
        lineOfAddr = new Map();
        if (!info) {
          setContent('', false);
          fileName.textContent = 'no program';
        } else if (info.source !== undefined) {
          name = info.name;
          language = info.language ?? 'asm';
          fileName.textContent = `${info.name.replace(' (rev)', '')}${language === 'rev' ? '.rev' : '.s'}`;
          for (const r of info.listing ?? []) {
            if (r.line > 0 && !addrOfLine.has(r.line)) addrOfLine.set(r.line, r.addr);
            if (r.line > 0 && !lineOfAddr.has(r.addr)) lineOfAddr.set(r.addr, r.line);
          }
          setContent(info.source, hooks.canBuild);
        } else {
          name = info.name;
          language = 'asm';
          fileName.textContent = `${info.name} (disassembly)`;
          const code = info.codeLen > 0 ? vm.code(0, info.codeLen) : new Uint32Array(0);
          const rows = Array.from(code, (w, a) => {
            const d = disassemble(w, info.labels);
            const label = info.labels.get(a);
            return `${String(a).padStart(4)}  ${label ? `${label}:`.padEnd(10) : ''.padEnd(10)}${d.mnemonic.padEnd(6)}${d.operands}`;
          });
          rows.forEach((_, a) => { addrOfLine.set(a + 1, a); lineOfAddr.set(a, a + 1); });
          setContent(rows.join('\n'), false);
        }
        scroll.scrollTop = 0;
        lastT = -1;
      }
      pcLine = lineOfAddr.get(snap.pc) ?? -1;
      paintMarks();
      if (snap.t !== lastT) {
        lastT = snap.t;
        if (followBox.checked && pcLine > 0) reveal(pcLine, false);
      }
    },
  };
}
