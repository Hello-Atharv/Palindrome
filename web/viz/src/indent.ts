/**
 * What Tab and Shift+Tab do in the code editor, as a pure function so it can be tested without a browser.
 * Tab with nothing selected inserts two spaces; with lines selected it indents each of them; Shift+Tab takes up to two spaces
 * (or one tab character) off the front of the lines the selection touches.
 */
export const INDENT = '  ';

export interface IndentEdit {
  /** Replace value.slice(from, to) with `text`, then select [selStart, selEnd]. */
  from: number;
  to: number;
  text: string;
  selStart: number;
  selEnd: number;
}

export function indentEdit(value: string, start: number, end: number, outdent: boolean): IndentEdit {
  if (start === end && !outdent) return { from: start, to: start, text: INDENT, selStart: start + INDENT.length, selEnd: start + INDENT.length };

  const blockStart = value.lastIndexOf('\n', start - 1) + 1;
  // a selection that ends just after a line break does not touch the next line
  const last = end > start && value[end - 1] === '\n' ? end - 1 : end;
  const nl = value.indexOf('\n', last);
  const blockEnd = nl === -1 ? value.length : nl;

  let firstDelta = 0;
  let total = 0;
  const lines = value.slice(blockStart, blockEnd).split('\n').map((line, i) => {
    let delta = 0;
    let out = line;
    if (!outdent) {
      if (line !== '') { out = INDENT + line; delta = INDENT.length; }
    } else if (line.startsWith('\t')) {
      out = line.slice(1);
      delta = -1;
    } else {
      const n = /^ {1,2}/.exec(line)?.[0].length ?? 0;
      out = line.slice(n);
      delta = -n;
    }
    if (i === 0) firstDelta = delta;
    total += delta;
    return out;
  });
  const text = lines.join('\n');
  const selStart = Math.max(blockStart, start + firstDelta);
  const selEnd = Math.max(selStart, end + total);
  return { from: blockStart, to: blockEnd, text, selStart, selEnd };
}

/** Apply an edit to a string (what the browser does for us in the editor; here so tests can check the result). */
export function applyEdit(value: string, e: IndentEdit): { value: string; selStart: number; selEnd: number } {
  return { value: value.slice(0, e.from) + e.text + value.slice(e.to), selStart: e.selStart, selEnd: e.selEnd };
}
