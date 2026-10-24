// Structured macros, expanded to plain br/lnd before assembly (Janus-style, see spec/SPEC.md section 6).
//
//   .if cc, ra, rb         entry test: take the "then" side when cc holds
//     ...then body...
//   .else                  optional
//     ...else body...
//   .fi cc, ra, rb         exit assertion: cc holds iff we arrived from the ELSE side
//
//   .loop cc, ra, rb       loop head: cc holds iff we arrived by the back edge (false on first entry)
//     ...body...
//   .again cc, ra, rb      go around again while cc holds
//
// The .if test is evaluated only on entry, so bodies may change the registers it names; what matters is that the
// .fi assertion is true after the else side and false after the then side. Generated labels start with "$" (user
// labels may not), and are hidden from the symbol table.

import type { Diagnostic } from './diag.js';
import type { Stmt } from './parser.js';

const MACROS = new Set(['.if', '.else', '.fi', '.loop', '.again']);

interface Frame {
  kind: 'if' | 'loop';
  id: number;
  open: Stmt;
  inElse: boolean;
  body: Stmt[]; // then body (if) or loop body
  elseBody: Stmt[];
}

export function expandMacros(stmts: Stmt[], diagnostics: Diagnostic[]): Stmt[] {
  const root: Stmt[] = [];
  const stack: Frame[] = [];
  let counter = 0;

  const err = (line: number, message: string): void => {
    diagnostics.push({ severity: 'error', line, message });
  };
  const sink = (): Stmt[] => {
    const f = stack[stack.length - 1];
    if (!f) return root;
    return f.kind === 'if' && f.inElse ? f.elseBody : f.body;
  };
  const gen = (from: Stmt, labels: string[], op: string, operands: string[], note: string): Stmt => ({
    line: from.line,
    labels,
    op,
    operands,
    text: `${op} ${operands.join(', ')}    ; ${note}`,
  });
  const needThree = (s: Stmt): boolean => {
    if (s.operands.length === 3) return true;
    err(s.line, `${s.op} takes "cc, ra, rb"`);
    return false;
  };

  for (const s of stmts) {
    if (s.op === null || !MACROS.has(s.op)) {
      sink().push(s);
      continue;
    }
    switch (s.op) {
      case '.if':
      case '.loop':
        if (needThree(s)) {
          stack.push({ kind: s.op === '.if' ? 'if' : 'loop', id: counter++, open: s, inElse: false, body: [], elseBody: [] });
        } else {
          // keep nesting balanced so one bad header does not hide later errors
          stack.push({ kind: s.op === '.if' ? 'if' : 'loop', id: counter++, open: { ...s, operands: ['al', 'r0', 'r0'] }, inElse: false, body: [], elseBody: [] });
        }
        break;
      case '.else': {
        const f = stack[stack.length - 1];
        if (s.labels.length > 0) err(s.line, 'a label cannot be attached to .else');
        if (!f || f.kind !== 'if') err(s.line, '.else without a matching .if');
        else if (f.inElse) err(s.line, 'a second .else for the same .if');
        else f.inElse = true;
        break;
      }
      case '.fi': {
        const f = stack[stack.length - 1];
        if (!f || f.kind !== 'if') {
          err(s.line, '.fi without a matching .if');
          break;
        }
        stack.pop();
        if (!needThree(s)) break;
        const L = (part: string): string => `$if${f.id}_${part}`;
        const [cc, ra, rb] = f.open.operands;
        sink().push(
          { ...f.open, labels: [...f.open.labels, L('s0')], op: 'br', operands: [cc, ra, rb, L('then')] },
          ...f.elseBody,
          gen(s, [L('s1')], 'br', ['al', L('end')], 'jump over the then body'),
          gen(s, [L('then')], 'lnd', ['al', 'r0', 'r0', L('s0')], 'then side is entered only by the jump'),
          ...f.body,
          { ...s, labels: [...s.labels, L('end')], op: 'lnd', operands: [s.operands[0], s.operands[1], s.operands[2], L('s1')] },
        );
        break;
      }
      case '.again': {
        const f = stack[stack.length - 1];
        if (!f || f.kind !== 'loop') {
          err(s.line, '.again without a matching .loop');
          break;
        }
        stack.pop();
        if (!needThree(s)) break;
        const L = (part: string): string => `$loop${f.id}_${part}`;
        const [cc, ra, rb] = f.open.operands;
        sink().push(
          { ...f.open, labels: [...f.open.labels, L('head')], op: 'lnd', operands: [cc, ra, rb, L('back')] },
          ...f.body,
          { ...s, labels: [...s.labels, L('back')], op: 'br', operands: [s.operands[0], s.operands[1], s.operands[2], L('head')] },
        );
        break;
      }
    }
  }

  for (const f of stack) {
    err(f.open.line, `${f.open.op} is never closed (${f.kind === 'if' ? '.fi' : '.again'} missing)`);
  }
  return root;
}
