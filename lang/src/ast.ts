// Syntax tree of rev. Every node carries the source line it came from, so the cost report can say which line costs what.

export type RelOp = '==' | '!=' | '<' | '>' | '<=' | '>=';

export type Expr =
  | { k: 'num'; value: number; line: number } // unsigned 32-bit
  | { k: 'var'; name: string; line: number }
  | { k: 'bin'; op: '+' | '-' | '^' | '&' | '|'; a: Expr; b: Expr; line: number }
  | { k: 'not'; a: Expr; line: number }
  | { k: 'neg'; a: Expr; line: number }
  | { k: 'rol'; a: Expr; n: number; line: number };

/** A condition compares two operands, each a variable or a constant. */
export interface Cond {
  op: RelOp;
  a: Expr & ({ k: 'num' } | { k: 'var' });
  b: Expr & ({ k: 'num' } | { k: 'var' });
  line: number;
}

export type Stmt =
  | { k: 'assign'; target: string; op: '+=' | '-=' | '^='; e: Expr; line: number }
  | { k: 'swap'; a: string; b: string; line: number }
  | { k: 'if'; test: Cond; then: Stmt[]; else: Stmt[]; fi: Cond; line: number }
  | { k: 'from'; entry: Cond; body1: Stmt[]; body2: Stmt[]; until: Cond; line: number }
  | { k: 'call'; name: string; line: number }
  | { k: 'uncall'; name: string; line: number }
  | { k: 'skip'; line: number };

export interface VarDecl {
  name: string;
  init: number;
  line: number;
}

export interface ProcDecl {
  name: string;
  body: Stmt[];
  line: number;
}

export interface Program {
  vars: VarDecl[];
  outs: { name: string; line: number }[];
  procs: ProcDecl[];
  main: Stmt[] | null;
  mainLine: number;
}

export interface Diagnostic {
  line: number;
  message: string;
}
