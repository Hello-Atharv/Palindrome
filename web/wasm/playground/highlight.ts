// Syntax colouring and error marks for rev source, as HTML for a <pre> laid under a transparent <textarea>.
// Browser-safe, no dependencies; the colours match the VS Code grammar's categories (vscode/syntaxes/rev.tmLanguage.json).

const KEYWORD = new Set(['if', 'else', 'fi', 'from', 'do', 'loop', 'until', 'skip']);
const FLOW = new Set(['call', 'uncall']);
const DECL = new Set(['var', 'out', 'proc', 'main']);
const INPUT = new Set(['events', 'latest']);

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const span = (cls: string, text: string): string => `<span class="${cls}">${esc(text)}</span>`;

const TOKEN = /(\/\/.*$)|(\b0[xX][0-9a-fA-F_]+\b|\b0[bB][01_]+\b|\b\d[\d_]*\b)|(\b[A-Za-z_]\w*\b)|(<=>|\+=|-=|\^=|==|!=|<=|>=|[<>+\-^&|~=@])/y;

/** One line of source as highlighted HTML. */
export function highlightLine(line: string): string {
  let out = '';
  let i = 0;
  let prev = ''; // the previous identifier, to name procedures
  while (i < line.length) {
    TOKEN.lastIndex = i;
    const m = TOKEN.exec(line);
    if (!m) { out += esc(line[i]); i++; continue; }
    const [text, comment, num, word, op] = m;
    if (comment) out += span('t-comment', text);
    else if (num) out += span('t-num', text);
    else if (op) out += span(op === '<=>' ? 't-swap' : /^(\+=|-=|\^=)$/.test(op) ? 't-assign' : 't-op', text);
    else if (word) {
      let cls = '';
      if (DECL.has(text)) cls = 't-decl';
      else if (KEYWORD.has(text)) cls = 't-kw';
      else if (FLOW.has(text)) cls = 't-flow';
      else if (INPUT.has(text)) cls = 't-input';
      else if (text === 'rol' && line.slice(i + text.length).trimStart().startsWith('(')) cls = 't-builtin';
      else if (text === 'mem' && prev === '@') cls = 't-decl';
      else if (prev === 'proc' || prev === 'call' || prev === 'uncall') cls = 't-fn';
      out += cls ? span(cls, text) : esc(text);
    } else out += esc(text);
    prev = word ? text : op === '@' ? '@' : '';
    i += text.length;
  }
  return out;
}

/** The whole source as HTML; `errors` maps a 1-based line number to its message and underlines that line. */
export function highlightRev(source: string, errors: Map<number, string> = new Map()): string {
  return source
    .split('\n')
    .map((line, k) => {
      const html = highlightLine(line) || '&#8203;';
      const msg = errors.get(k + 1);
      return msg ? `<span class="t-err" title="${esc(msg).replace(/"/g, '&quot;')}">${html}</span>` : html;
    })
    .join('\n') + '\n';
}
