// Syntax tree of rev. Every node carries the source line it came from, so the cost report can say which line costs what.

export type RelOp = '==' | '!=' | '<' | '>' | '<=' | '>=';

export type Expr =
  | { k: 'num'; value: number; line: number } // unsigned 32-bit
  | { k: 'var'; name: string; line: number }
  | { k: 'idx'; name: string; index: Expr; line: number } // array element
  | { k: 'input'; which: 'events' | 'latest'; line: number } // the input window: how many key events so far / the latest one
  | { k: 'bin'; op: '+' | '-' | '^' | '&' | '|'; a: Expr; b: Expr; line: number }
  | { k: 'not'; a: Expr; line: number }
  | { k: 'neg'; a: Expr; line: number }
  | { k: 'rol'; a: Expr; n: number; line: number };

/** A condition operand: a constant, a variable, or an array element. */
export type Operand = Extract<Expr, { k: 'num' } | { k: 'var' } | { k: 'idx' }>;

/** A condition compares two operands. */
export interface Cond {
  op: RelOp;
  a: Operand;
  b: Operand;
  line: number;
}

/** Something that can be assigned to: a variable or an array element. */
export interface LValue {
  name: string;
  index?: Expr;
  line: number;
}

export type Stmt =
  | { k: 'assign'; target: LValue; op: '+=' | '-=' | '^='; e: Expr; line: number }
  | { k: 'swap'; a: LValue; b: LValue; line: number }
  | { k: 'if'; test: Cond; then: Stmt[]; else: Stmt[]; fi: Cond; line: number }
  | { k: 'from'; entry: Cond; body1: Stmt[]; body2: Stmt[]; until: Cond; line: number }
  | { k: 'call'; name: string; line: number }
  | { k: 'uncall'; name: string; line: number }
  | { k: 'skip'; line: number };

export interface VarDecl {
  name: string;
  /** the initial value (a scalar: one word) or the initial words (an array; fewer than `size` means the rest are zero) */
  init: number[];
  /** array length, or 0 for a scalar */
  size: number;
  /** absolute data address (`var screen[2048] @ 0x20000;`); otherwise the compiler places it */
  addr?: number;
  /** `var x @ mem`: keep this scalar in memory even though a register is free */
  inMemory?: boolean;
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
