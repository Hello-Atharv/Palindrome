// Lexer and recursive-descent parser for rev. Syntax summary (full description: lang/README.md):
//
//   var n = 10, a = 0, b = 1;        out a;
//   proc step { a += b; a <=> b; }
//   main {
//     from (i == 0) loop { call step; i += 1; } until (i == n);
//     if (a < b) { ... } else { ... } fi (a < b);
//   }

import type { Cond, Diagnostic, Expr, LValue, Operand, Program, RelOp, Stmt } from './ast.js';

interface Token {
  t: 'id' | 'num' | 'op' | 'eof';
  s: string;
  line: number;
  value?: number;
}

const OPS = ['<=>', '+=', '-=', '^=', '==', '!=', '<=', '>=', '<', '>', '+', '-', '^', '&', '|', '~', '(', ')', '{', '}', '[', ']', ',', ';', '=', '@'];

export class ParseError extends Error {
  constructor(readonly line: number, message: string) {
    super(message);
  }
}

function lex(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  let line = 1;
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[\w]/.test(src[j])) j++;
      out.push({ t: 'id', s: src.slice(i, j), line });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9a-fA-FxXbB_]/.test(src[j])) j++;
      const text = src.slice(i, j).replace(/_/g, '');
      if (!/^(0[xX][0-9a-fA-F]+|0[bB][01]+|[0-9]+)$/.test(text)) throw new ParseError(line, `bad number '${text}'`);
      const value = Number(text);
      if (value > 0xffffffff) throw new ParseError(line, `number '${text}' does not fit in 32 bits`);
      out.push({ t: 'num', s: text, line, value });
      i = j;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new ParseError(line, `unexpected character '${c}'`);
    out.push({ t: 'op', s: op, line });
    i += op.length;
  }
  out.push({ t: 'eof', s: '<end of file>', line });
  return out;
}

const KEYWORDS = new Set(['var', 'out', 'proc', 'main', 'if', 'else', 'fi', 'from', 'do', 'loop', 'until', 'call', 'uncall', 'skip', 'rol', 'events', 'latest']);

class Parser {
  private p = 0;
  constructor(private readonly toks: Token[]) {}

  private get cur(): Token { return this.toks[this.p]; }
  private next(): Token { return this.toks[this.p++]; }
  private isOp(s: string): boolean { return this.cur.t === 'op' && this.cur.s === s; }
  private isKw(s: string): boolean { return this.cur.t === 'id' && this.cur.s === s; }
  private fail(msg: string): never { throw new ParseError(this.cur.line, msg); }
  private expectOp(s: string): Token {
    if (!this.isOp(s)) this.fail(`expected '${s}' but found '${this.cur.s}'`);
    return this.next();
  }
  private expectKw(s: string): Token {
    if (!this.isKw(s)) this.fail(`expected '${s}' but found '${this.cur.s}'`);
    return this.next();
  }
  private ident(what: string): Token {
    if (this.cur.t !== 'id' || KEYWORDS.has(this.cur.s)) this.fail(`expected ${what} but found '${this.cur.s}'`);
    return this.next();
  }
  private number(): number {
    let neg = false;
    if (this.isOp('-')) { this.next(); neg = true; }
    if (this.cur.t !== 'num') this.fail(`expected a number but found '${this.cur.s}'`);
    const v = this.next().value!;
    return neg ? (-v) >>> 0 : v;
  }

  program(): Program {
    const prog: Program = { vars: [], outs: [], procs: [], main: null, mainLine: 0 };
    while (this.cur.t !== 'eof') {
      if (this.isKw('var')) {
        this.next();
        do {
          const id = this.ident('a variable name');
          let size = 0;
          let init: number[] = [0];
          if (this.isOp('[')) {
            this.next();
            size = this.number();
            if (size < 1 || size > 0xf000) throw new ParseError(id.line, 'array size must be 1..61440');
            this.expectOp(']');
            init = [];
          }
          let addr: number | undefined;
          if (this.isOp('@')) { this.next(); addr = this.number(); }
          if (this.isOp('=')) {
            this.next();
            if (size) {
              this.expectOp('{');
              while (!this.isOp('}')) {
                init.push(this.number());
                if (this.isOp(',')) this.next();
                else break;
              }
              this.expectOp('}');
              if (init.length > size) throw new ParseError(id.line, `too many initial values for ${id.s}[${size}]`);
            } else init = [this.number()];
          }
          prog.vars.push({ name: id.s, init, size, addr, line: id.line });
        } while (this.isOp(',') && this.next());
        this.expectOp(';');
      } else if (this.isKw('out')) {
        this.next();
        do {
          const id = this.ident('a variable name');
          prog.outs.push({ name: id.s, line: id.line });
        } while (this.isOp(',') && this.next());
        this.expectOp(';');
      } else if (this.isKw('proc')) {
        const kw = this.next();
        const id = this.ident('a procedure name');
        prog.procs.push({ name: id.s, body: this.block(), line: kw.line });
      } else if (this.isKw('main')) {
        const kw = this.next();
        if (prog.main) throw new ParseError(kw.line, 'main is defined twice');
        prog.mainLine = kw.line;
        prog.main = this.block();
      } else {
        this.fail(`expected 'var', 'out', 'proc' or 'main' but found '${this.cur.s}'`);
      }
    }
    return prog;
  }

  private block(): Stmt[] {
    this.expectOp('{');
    const out: Stmt[] = [];
    while (!this.isOp('}')) {
      if (this.cur.t === 'eof') this.fail("missing '}'");
      out.push(this.stmt());
    }
    this.next();
    return out;
  }

  private stmt(): Stmt {
    const line = this.cur.line;
    if (this.isKw('skip')) { this.next(); this.expectOp(';'); return { k: 'skip', line }; }
    if (this.isKw('call') || this.isKw('uncall')) {
      const k = this.next().s as 'call' | 'uncall';
      const name = this.ident('a procedure name').s;
      this.expectOp(';');
      return { k, name, line };
    }
    if (this.isKw('if')) {
      this.next();
      this.expectOp('(');
      const test = this.cond();
      this.expectOp(')');
      const then = this.block();
      let els: Stmt[] = [];
      if (this.isKw('else')) { this.next(); els = this.block(); }
      this.expectKw('fi');
      this.expectOp('(');
      const fi = this.cond();
      this.expectOp(')');
      if (this.isOp(';')) this.next();
      return { k: 'if', test, then, else: els, fi, line };
    }
    if (this.isKw('from')) {
      this.next();
      this.expectOp('(');
      const entry = this.cond();
      this.expectOp(')');
      let body1: Stmt[] = [];
      let body2: Stmt[] = [];
      if (this.isKw('do')) { this.next(); body1 = this.block(); }
      if (this.isKw('loop')) { this.next(); body2 = this.block(); }
      this.expectKw('until');
      this.expectOp('(');
      const until = this.cond();
      this.expectOp(')');
      if (this.isOp(';')) this.next();
      return { k: 'from', entry, body1, body2, until, line };
    }
    const target = this.lvalue('a statement');
    if (this.isOp('<=>')) {
      this.next();
      const other = this.lvalue('a variable name');
      this.expectOp(';');
      return { k: 'swap', a: target, b: other, line };
    }
    if (this.isOp('+=') || this.isOp('-=') || this.isOp('^=')) {
      const op = this.next().s as '+=' | '-=' | '^=';
      const e = this.expr();
      this.expectOp(';');
      return { k: 'assign', target, op, e, line };
    }
    if (this.isOp('=')) this.fail(`plain '=' would destroy the old value; use +=, -= or ^= (or <=> to swap)`);
    this.fail(`expected '+=', '-=', '^=' or '<=>' after '${target.name}' but found '${this.cur.s}'`);
  }

  private lvalue(what: string): LValue {
    const id = this.ident(what);
    if (!this.isOp('[')) return { name: id.s, line: id.line };
    this.next();
    const index = this.expr();
    this.expectOp(']');
    return { name: id.s, index, line: id.line };
  }

  private operand(): Operand {
    const line = this.cur.line;
    if (this.cur.t === 'num' || this.isOp('-')) return { k: 'num', value: this.number(), line };
    const id = this.ident('a variable or a number');
    if (!this.isOp('[')) return { k: 'var', name: id.s, line };
    this.next();
    const index = this.expr();
    this.expectOp(']');
    return { k: 'idx', name: id.s, index, line };
  }

  private cond(): Cond {
    const line = this.cur.line;
    const a = this.operand();
    const ops: RelOp[] = ['==', '!=', '<=', '>=', '<', '>'];
    const op = ops.find((o) => this.isOp(o));
    if (!op) this.fail(`expected a comparison (==, !=, <, >, <=, >=) but found '${this.cur.s}'`);
    this.next();
    const b = this.operand();
    return { op, a, b, line };
  }

  // expressions: | lowest, then ^, then &, then + -, then unary
  private expr(): Expr { return this.binary(0); }

  private static readonly LEVELS: ('|' | '^' | '&' | '+' | '-')[][] = [['|'], ['^'], ['&'], ['+', '-']];

  private binary(level: number): Expr {
    if (level === Parser.LEVELS.length) return this.unary();
    let a = this.binary(level + 1);
    for (;;) {
      const ops = Parser.LEVELS[level];
      const op = ops.find((o) => this.isOp(o));
      if (!op) return a;
      const line = this.next().line;
      const b = this.binary(level + 1);
      a = fold({ k: 'bin', op, a, b, line });
    }
  }

  private unary(): Expr {
    const line = this.cur.line;
    if (this.isOp('~')) { this.next(); return fold({ k: 'not', a: this.unary(), line }); }
    if (this.isOp('-')) { this.next(); return fold({ k: 'neg', a: this.unary(), line }); }
    return this.primary();
  }

  private primary(): Expr {
    const line = this.cur.line;
    if (this.cur.t === 'num') return { k: 'num', value: this.next().value!, line };
    if (this.isOp('(')) {
      this.next();
      const e = this.expr();
      this.expectOp(')');
      return e;
    }
    if (this.isKw('rol')) {
      this.next();
      this.expectOp('(');
      const a = this.expr();
      this.expectOp(',');
      const n = this.number();
      this.expectOp(')');
      if (n > 31) throw new ParseError(line, 'rol count must be 0..31');
      return fold({ k: 'rol', a, n, line });
    }
    if (this.isKw('events') || this.isKw('latest')) return { k: 'input', which: this.next().s as 'events' | 'latest', line };
    const id = this.ident('an expression');
    if (!this.isOp('[')) return { k: 'var', name: id.s, line };
    this.next();
    const index = this.expr();
    this.expectOp(']');
    return { k: 'idx', name: id.s, index, line };
  }
}

const rotl = (x: number, n: number): number => ((x << n) | (x >>> (32 - n))) >>> 0;

/** Constant folding: operations on two constants become one constant. */
function fold(e: Expr): Expr {
  const num = (x: Expr): x is Expr & { k: 'num' } => x.k === 'num';
  switch (e.k) {
    case 'bin':
      if (num(e.a) && num(e.b)) {
        const x = e.a.value;
        const y = e.b.value;
        const v = e.op === '+' ? x + y : e.op === '-' ? x - y : e.op === '^' ? x ^ y : e.op === '&' ? x & y : x | y;
        return { k: 'num', value: v >>> 0, line: e.line };
      }
      return e;
    case 'not': return num(e.a) ? { k: 'num', value: ~e.a.value >>> 0, line: e.line } : e;
    case 'neg': return num(e.a) ? { k: 'num', value: -e.a.value >>> 0, line: e.line } : e;
    case 'rol': return num(e.a) ? { k: 'num', value: rotl(e.a.value, e.n), line: e.line } : e;
    default: return e;
  }
}

export function parse(src: string): { program?: Program; diagnostics: Diagnostic[] } {
  try {
    return { program: new Parser(lex(src)).program(), diagnostics: [] };
  } catch (e) {
    if (e instanceof ParseError) return { diagnostics: [{ line: e.line, message: e.message }] };
    throw e;
  }
}
