// Constant expressions: numbers, symbols, + - and parentheses. Used for immediates, offsets and .word values.

export type Lookup = (name: string) => number | undefined;
export type ExprResult = { ok: true; value: number } | { ok: false; error: string };

const TOKEN = /\s*(0[xX][0-9a-fA-F]+|0[bB][01]+|\d+|'(?:\\.|[^'\\])'|[A-Za-z_.$][\w.$]*|[()+\-])/y;

function charValue(lit: string): number {
  const body = lit.slice(1, -1);
  if (body[0] !== '\\') return body.charCodeAt(0);
  const map: Record<string, number> = { n: 10, r: 13, t: 9, '0': 0, '\\': 92, "'": 39 };
  return map[body[1]] ?? body.charCodeAt(1);
}

export function evalExpr(text: string, lookup: Lookup): ExprResult {
  const src = text.trim();
  if (src === '') return { ok: false, error: 'missing value' };

  const tokens: string[] = [];
  let pos = 0;
  while (pos < src.length) {
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(src);
    if (!m) return { ok: false, error: `cannot parse "${src.slice(pos).trim()}"` };
    tokens.push(m[1]);
    pos = TOKEN.lastIndex;
    while (pos < src.length && /\s/.test(src[pos])) pos++;
  }

  let i = 0;
  let error: string | null = null;
  const fail = (msg: string): number => {
    if (error === null) error = msg;
    return 0;
  };

  const primary = (): number => {
    const t = tokens[i++];
    if (t === undefined) return fail('expression ends unexpectedly');
    if (t === '-') return -primary();
    if (t === '+') return primary();
    if (t === '(') {
      const v = sum();
      if (tokens[i++] !== ')') return fail('missing )');
      return v;
    }
    if (/^0[xX]/.test(t)) return parseInt(t.slice(2), 16);
    if (/^0[bB]/.test(t)) return parseInt(t.slice(2), 2);
    if (/^\d/.test(t)) return parseInt(t, 10);
    if (t[0] === "'") return charValue(t);
    if (/^[A-Za-z_.$]/.test(t)) {
      const v = lookup(t);
      if (v === undefined) return fail(`undefined symbol "${t}"`);
      return v;
    }
    return fail(`unexpected "${t}"`);
  };

  const sum = (): number => {
    let v = primary();
    while (tokens[i] === '+' || tokens[i] === '-') {
      const op = tokens[i++];
      const r = primary();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };

  const value = sum();
  if (error === null && i < tokens.length) fail(`unexpected "${tokens[i]}"`);
  return error === null ? { ok: true, value } : { ok: false, error };
}
