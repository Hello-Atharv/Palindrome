// Source-level inversion: the program that undoes a program (Janus's inverse semantics).
// `uncall p` runs the inverse of p, which the compiler generates as a separate procedure.

import type { Stmt } from './ast.js';

export function invertStmt(s: Stmt): Stmt {
  switch (s.k) {
    case 'assign':
      return { ...s, op: s.op === '+=' ? '-=' : s.op === '-=' ? '+=' : '^=' };
    case 'swap':
    case 'skip':
      return s;
    case 'call':
      return { k: 'uncall', name: s.name, line: s.line };
    case 'uncall':
      return { k: 'call', name: s.name, line: s.line };
    case 'if':
      // if (e) S1 else S2 fi (e')  undone is  if (e') S1^-1 else S2^-1 fi (e)
      return { ...s, test: s.fi, fi: s.test, then: invertBlock(s.then), else: invertBlock(s.else) };
    case 'from':
      // from (e1) do S1 loop S2 until (e2)  undone is  from (e2) do S1^-1 loop S2^-1 until (e1)
      return { ...s, entry: s.until, until: s.entry, body1: invertBlock(s.body1), body2: invertBlock(s.body2) };
  }
}

export function invertBlock(b: Stmt[]): Stmt[] {
  return b.map(invertStmt).reverse();
}
