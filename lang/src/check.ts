// Static checks for rev. These are the rules that keep a program reversible; the code generator relies on them.

import type { Cond, Diagnostic, Expr, LValue, Program, Stmt } from './ast.js';
import { CONSOLE_START, type VarInfo } from './layout.js';

/** Names (variables and arrays) read by an expression, including inside array indexes. */
export function reads(e: Expr, into: Set<string> = new Set()): Set<string> {
  switch (e.k) {
    case 'var': into.add(e.name); break;
    case 'idx': into.add(e.name); reads(e.index, into); break;
    case 'bin': reads(e.a, into); reads(e.b, into); break;
    case 'not': case 'neg': case 'rol': reads(e.a, into); break;
    case 'num': case 'input': break;
  }
  return into;
}

export function check(prog: Program, vars: Map<string, VarInfo>): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const err = (line: number, message: string): void => { diags.push({ line, message }); };

  const seen = new Set<string>();
  for (const v of prog.vars) {
    if (seen.has(v.name)) err(v.line, `variable '${v.name}' is declared twice`);
    seen.add(v.name);
  }
  for (const o of prog.outs) if (!vars.has(o.name)) err(o.line, `out: '${o.name}' is not a declared variable`);

  const procs = new Map<string, number>();
  for (const p of prog.procs) {
    if (procs.has(p.name)) err(p.line, `procedure '${p.name}' is defined twice`);
    procs.set(p.name, p.line);
  }
  if (!prog.main) err(1, "the program has no 'main { ... }'");

  const isArray = (n: string): boolean => {
    const v = vars.get(n);
    return !!v && v.kind === 'mem' && v.isArray;
  };

  /** every name in an expression exists, arrays are indexed and scalars are not */
  const exprNames = (e: Expr, line: number): void => {
    switch (e.k) {
      case 'var':
        if (!vars.has(e.name)) err(line, `unknown variable '${e.name}'`);
        else if (isArray(e.name)) err(line, `'${e.name}' is an array: write ${e.name}[index]`);
        break;
      case 'idx':
        if (!vars.has(e.name)) err(line, `unknown variable '${e.name}'`);
        else if (!isArray(e.name)) err(line, `'${e.name}' is not an array`);
        exprNames(e.index, line);
        break;
      case 'bin': exprNames(e.a, line); exprNames(e.b, line); break;
      case 'not': case 'neg': case 'rol': exprNames(e.a, line); break;
      case 'num': case 'input': break;
    }
  };

  const lvalueNames = (lv: LValue, line: number): void => {
    if (!vars.has(lv.name)) { err(line, `unknown variable '${lv.name}'`); return; }
    if (lv.index) {
      if (!isArray(lv.name)) err(line, `'${lv.name}' is not an array`);
      exprNames(lv.index, line);
    } else if (isArray(lv.name)) err(line, `'${lv.name}' is an array: write ${lv.name}[index]`);
  };

  /** condition operands; `simple` means no array elements (used where the machine tests them after the bodies have run) */
  const condNames = (c: Cond, line: number, simple: string | null): void => {
    for (const x of [c.a, c.b]) {
      exprNames(x, line);
      if (x.k === 'var' && simple && vars.get(x.name)?.kind === 'mem') {
        err(line, `${simple} cannot compare '${x.name}': it lives in memory (only the first nine scalars get registers); copy it into a register variable first`);
      }
      if (x.k === 'idx') {
        if (simple) err(line, `${simple} cannot compare an array element; copy it into a variable first`);
        if (x.index.k !== 'num' && x.index.k !== 'var') err(line, 'an array index inside a condition must be a variable or a constant');
      }
    }
  };

  const calls = new Map<string, Set<string>>();
  let usesPrint = false;
  const walk = (body: Stmt[], owner: string): void => {
    for (const s of body) {
      switch (s.k) {
        case 'print':
          usesPrint = true;
          for (const it of s.items) exprNames(it.e, s.line);
          break;
        case 'assign': {
          lvalueNames(s.target, s.line);
          exprNames(s.e, s.line);
          const r = reads(s.e);
          if (r.has(s.target.name)) {
            err(s.line, s.target.index
              ? `'${s.target.name}' is read on the right of an assignment to ${s.target.name}[...]; that could update an element from itself, which is not reversible (copy the value to another variable first)`
              : `'${s.target.name}' appears on both sides of '${s.op}'; that would not be reversible (copy it to another variable first)`);
          }
          if (s.target.index && reads(s.target.index).has(s.target.name)) {
            err(s.line, `the index of ${s.target.name}[...] cannot itself read ${s.target.name}`);
          }
          break;
        }
        case 'swap':
          lvalueNames(s.a, s.line);
          lvalueNames(s.b, s.line);
          if (!s.a.index && !s.b.index && s.a.name === s.b.name) err(s.line, `cannot swap '${s.a.name}' with itself`);
          // an index is read before the swap and read again afterwards to clear the temporaries: neither read may see a changed cell
          for (const lv of [s.a, s.b]) {
            if (lv.index && (reads(lv.index).has(s.a.name) || reads(lv.index).has(s.b.name))) {
              err(s.line, `the index in ${lv.name}[...] reads a variable that this swap changes`);
            }
          }
          break;
        case 'call': case 'uncall':
          if (!procs.has(s.name)) err(s.line, `unknown procedure '${s.name}'`);
          calls.get(owner)?.add(s.name);
          break;
        case 'if':
          condNames(s.test, s.line, null);
          condNames(s.fi, s.line, "an 'fi' assertion");
          walk(s.then, owner);
          walk(s.else, owner);
          break;
        case 'from':
          condNames(s.entry, s.line, "a loop's 'from' condition");
          condNames(s.until, s.line, "a loop's 'until' condition");
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

  // the console (SPEC 11.9) occupies data words 0xE000..0xFFFE: nothing else may live there in a program that prints
  if (usesPrint) {
    for (const d of prog.vars) {
      const v = vars.get(d.name);
      if (v && v.kind === 'mem' && v.addr <= 0xfffe && v.addr + v.size > CONSOLE_START) {
        err(d.line, `${d.name} overlaps the console (data words 0xE000 to 0xFFFE), which print uses`);
      }
    }
  }

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
