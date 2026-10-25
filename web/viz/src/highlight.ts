/** Syntax highlighting for the machine's assembly (spec/asm_syntax.md). Pure: text in, tokens out. */

export type TokenKind = 'comment' | 'directive' | 'label' | 'op' | 'flow' | 'register' | 'number' | 'cond' | 'plain';

export interface Token {
  kind: TokenKind;
  text: string;
}

/** Data and arithmetic instructions, and the pseudo-ops the assembler adds. */
const OPS = new Set(['nop', 'add', 'sub', 'addi', 'subi', 'xor', 'xori', 'not', 'neg', 'swap', 'roli', 'xld', 'xst', 'cswap', 'toff']);
/** Instructions that change where execution goes, or stop it. */
const FLOW = new Set(['br', 'lnd', 'call', 'proc', 'ret', 'hlt']);
const CONDS = new Set(['al', 'eq', 'ne', 'lt']);
const REG = /^(r(?:[0-9]|1[0-5])|sp)$/i;
const NUM = /^-?(?:0x[0-9a-f]+|[0-9]+)$/i;
const WORD = /[A-Za-z_.$][\w.$]*|-?(?:0x[0-9a-fA-F]+|\d+)|\s+|./g;

function classify(word: string, afterLabelColon: boolean): TokenKind {
  const w = word.toLowerCase();
  if (word.startsWith('.')) return 'directive';
  if (afterLabelColon) return 'label';
  if (OPS.has(w)) return 'op';
  if (FLOW.has(w)) return 'flow';
  if (REG.test(word)) return 'register';
  if (CONDS.has(w)) return 'cond';
  if (NUM.test(word)) return 'number';
  return 'plain';
}

/** Split one line into tokens. Everything after `;` is a comment; `name:` at the start is a label. */
export function tokenizeLine(line: string): Token[] {
  const semi = line.indexOf(';');
  const code = semi >= 0 ? line.slice(0, semi) : line;
  const out: Token[] = [];
  const parts = code.match(WORD) ?? [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const isLabel = /^[A-Za-z_$][\w.$]*$/.test(p) && parts[i + 1] === ':' && parts.slice(0, i).every((q) => /^\s+$/.test(q));
    out.push({ kind: /^\s+$/.test(p) ? 'plain' : classify(p, isLabel), text: p });
  }
  if (semi >= 0) out.push({ kind: 'comment', text: line.slice(semi) });
  // merge neighbouring tokens of the same kind so the DOM stays small
  return out.reduce<Token[]>((acc, t) => {
    const last = acc[acc.length - 1];
    if (last && last.kind === t.kind) last.text += t.text;
    else acc.push({ ...t });
    return acc;
  }, []);
}

export type Language = 'asm' | 'rev';

const REV_WORDS = /\/\/.*$|0[xX][0-9a-fA-F_]+|0[bB][01_]+|\d[\d_]*|[A-Za-z_]\w*|\s+|./g;
const REV_DECL = new Set(['var', 'out', 'proc', 'main']);
const REV_KEYWORD = new Set(['if', 'else', 'fi', 'from', 'do', 'loop', 'until', 'skip']);
const REV_CALL = new Set(['call', 'uncall']);

/** One line of rev source (lang/): // comments, declarations, control flow, calls, numbers. */
export function tokenizeRevLine(line: string): Token[] {
  const out: Token[] = [];
  for (const p of line.match(REV_WORDS) ?? []) {
    const kind: TokenKind = p.startsWith('//') ? 'comment'
      : /^(0[xX]|0[bB]|\d)/.test(p) ? 'number'
        : REV_DECL.has(p) ? 'directive'
          : REV_KEYWORD.has(p) ? 'flow'
            : REV_CALL.has(p) ? 'op'
              : 'plain';
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += p;
    else out.push({ kind, text: p });
  }
  return out;
}

/** Highlight a whole text: one token list per line. */
export function tokenize(text: string, language: Language = 'asm'): Token[][] {
  return text.split('\n').map(language === 'rev' ? tokenizeRevLine : tokenizeLine);
}
