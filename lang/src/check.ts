// Static checks for rev. These are the rules that keep a program reversible; the code generator relies on them.

import type { Cond, Diagnostic, Expr, Program, Stmt } from './ast.js';

/** Variables read by an expression. */
export function reads(e: Expr, into: Set<string> = new Set()): Set<string> {
  switch (e.k) {
    case 'var': into.add(e.name); break;
    case 'bin': reads(e.a, into); reads(e.b, into); break;
    case 'not': case 'neg': case 'rol': reads(e.a, into); break;
    case 'num': break;
  }
  return into;
}

export const MAX_VARS = 9; // r1..r9; r10..r13 and r15 are temporaries; r0 is zero, r14 the stack pointer

export function check(prog: Program): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const err = (line: number, message: string): void => { diags.push({ line, message }); };

  const vars = new Set<string>();
  for (const v of prog.vars) {
    if (vars.has(v.name)) err(v.line, `variable '${v.name}' is declared twice`);
    vars.add(v.name);
  }
  if (prog.vars.length > MAX_VARS) {
    err(prog.vars[MAX_VARS].line, `too many variables: the machine keeps ${MAX_VARS} in registers (memory variables are not supported yet)`);
  }
  for (const o of prog.outs) if (!vars.has(o.name)) err(o.line, `out: '${o.name}' is not a declared variable`);

  const procs = new Map<string, number>();
  for (const p of prog.procs) {
    if (procs.has(p.name)) err(p.line, `procedure '${p.name}' is defined twice`);
    procs.set(p.name, p.line);
  }
  if (!prog.main) err(1, "the program has no 'main { ... }'");

  const calls = new Map<string, Set<string>>();
  const condVars = (c: Cond, line: number): void => {
    for (const x of [c.a, c.b]) if (x.k === 'var' && !vars.has(x.name)) err(line, `unknown variable '${x.name}'`);
  };
  const walk = (body: Stmt[], owner: string): void => {
    for (const s of body) {
      switch (s.k) {
        case 'assign': {
          if (!vars.has(s.target)) err(s.line, `unknown variable '${s.target}'`);
          const r = reads(s.e);
          for (const n of r) if (!vars.has(n)) err(s.line, `unknown variable '${n}'`);
          if (r.has(s.target)) {
            err(s.line, `'${s.target}' appears on both sides of '${s.op}'; that would not be reversible (copy it to another variable first)`);
          }
          break;
        }
        case 'swap':
          if (!vars.has(s.a)) err(s.line, `unknown variable '${s.a}'`);
          if (!vars.has(s.b)) err(s.line, `unknown variable '${s.b}'`);
          if (s.a === s.b) err(s.line, `cannot swap '${s.a}' with itself`);
          break;
        case 'call': case 'uncall':
          if (!procs.has(s.name)) err(s.line, `unknown procedure '${s.name}'`);
          calls.get(owner)?.add(s.name);
          break;
        case 'if':
          condVars(s.test, s.line);
          condVars(s.fi, s.line);
          walk(s.then, owner);
          walk(s.else, owner);
          break;
        case 'from':
          condVars(s.entry, s.line);
          condVars(s.until, s.line);
          walk(s.body1, owner);
          walk(s.body2, owner);
          break;
        case 'skip': break;
      }
    }
  };
  for (const p of prog.procs) calls.set(p.name, new Set());
  calls.set('main', new Set());
  for (const p of prog.procs) walk(p.body, p.name);
  if (prog.main) walk(prog.main, 'main');

  // recursion: the generated inverse procedures and the static stack rules assume none (for now)
  const state = new Map<string, 0 | 1 | 2>();
  const dfs = (n: string, path: string[]): void => {
    if (state.get(n) === 2) return;
    if (state.get(n) === 1) {
      err(procs.get(n) ?? 1, `recursion is not supported yet (${[...path.slice(path.indexOf(n)), n].join(' -> ')})`);
      return;
    }
    state.set(n, 1);
    for (const m of calls.get(n) ?? []) if (procs.has(m)) dfs(m, [...path, n]);
    state.set(n, 2);
  };
  for (const n of calls.keys()) dfs(n, []);
  return diags;
}
