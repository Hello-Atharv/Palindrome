// A direct interpreter of rev's source semantics (Janus). It is the independent reference the compiled code is checked
// against: same variables after the program, and it detects violated assertions.
import type { Cond, Expr, LValue, Program, Stmt } from '../src/ast.js';

export class AssertionFailed extends Error {}

/** Final contents of every variable: a scalar is a one-element array. */
export type State = Map<string, number[]>;

export function interpret(prog: Program, input: number[] = [], maxSteps = 1_000_000): State {
  const vars: State = new Map(prog.vars.map((v) => {
    const words = v.size ? Array.from({ length: v.size }, (_, i) => (v.init[i] ?? 0) >>> 0) : [v.init[0] >>> 0];
    return [v.name, words];
  }));
  const procs = new Map(prog.procs.map((p) => [p.name, p.body]));
  let budget = maxSteps;

  const cell = (name: string, index: number): { words: number[]; at: number } => {
    const words = vars.get(name)!;
    if (index >= words.length) throw new Error(`${name}[${index}] is out of range`);
    return { words, at: index };
  };
  const place = (lv: LValue): { words: number[]; at: number } => cell(lv.name, lv.index ? ev(lv.index) : 0);

  function ev(e: Expr): number {
    switch (e.k) {
      case 'num': return e.value;
      case 'var': return vars.get(e.name)![0];
      case 'idx': { const c = cell(e.name, ev(e.index)); return c.words[c.at]; }
      case 'input': return e.which === 'events' ? input.length : input.length ? input[input.length - 1] : 0;
      case 'not': return ~ev(e.a) >>> 0;
      case 'neg': return -ev(e.a) >>> 0;
      case 'rol': { const x = ev(e.a); return e.n ? ((x << e.n) | (x >>> (32 - e.n))) >>> 0 : x; }
      case 'bin': {
        const a = ev(e.a);
        const b = ev(e.b);
        switch (e.op) {
          case '+': return (a + b) >>> 0;
          case '-': return (a - b) >>> 0;
          case '^': return (a ^ b) >>> 0;
          case '&': return (a & b) >>> 0;
          case '|': return (a | b) >>> 0;
        }
      }
    }
  }
  const cv = (c: Cond): boolean => {
    const a = ev(c.a) | 0;
    const b = ev(c.b) | 0;
    switch (c.op) {
      case '==': return a === b;
      case '!=': return a !== b;
      case '<': return a < b;
      case '>': return a > b;
      case '<=': return a <= b;
      case '>=': return a >= b;
    }
  };

  // A block is run backwards (`inv`) by taking its statements in reverse order, each with its own inverse meaning.
  const run = (body: Stmt[], inv: boolean): void => {
    const seq = inv ? [...body].reverse() : body;
    for (const s of seq) {
      if (--budget < 0) throw new Error('step budget exhausted');
      step(s, inv);
    }
  };
  const step = (s: Stmt, inv: boolean): void => {
    switch (s.k) {
      case 'skip': return;
      case 'swap': {
        const a = place(s.a);
        const b = place(s.b);
        const t = a.words[a.at];
        a.words[a.at] = b.words[b.at];
        b.words[b.at] = t;
        return;
      }
      case 'assign': {
        const v = ev(s.e);
        const op = inv ? (s.op === '+=' ? '-=' : s.op === '-=' ? '+=' : '^=') : s.op;
        const c = place(s.target);
        const x = c.words[c.at];
        c.words[c.at] = (op === '+=' ? x + v : op === '-=' ? x - v : x ^ v) >>> 0;
        return;
      }
      case 'call': run(procs.get(s.name)!, inv); return;
      case 'uncall': run(procs.get(s.name)!, !inv); return;
      case 'if': {
        const test = inv ? s.fi : s.test;
        const fi = inv ? s.test : s.fi;
        const t = cv(test);
        run(t ? s.then : s.else, inv);
        if (cv(fi) !== t) throw new AssertionFailed(`line ${s.line}: fi condition ${cv(fi)} after ${t ? 'then' : 'else'} branch`);
        return;
      }
      case 'from': {
        const entry = inv ? s.until : s.entry;
        const until = inv ? s.entry : s.until;
        if (!cv(entry)) throw new AssertionFailed(`line ${s.line}: loop entry condition false`);
        let first = true;
        for (;;) {
          if (!first && cv(entry)) throw new AssertionFailed(`line ${s.line}: loop entry condition true on a later pass`);
          first = false;
          run(s.body1, inv);
          if (cv(until)) return;
          run(s.body2, inv);
          if (--budget < 0) throw new Error('step budget exhausted');
        }
      }
    }
  };
  run(prog.main ?? [], false);
  return vars;
}
