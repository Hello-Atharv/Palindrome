// The compiler front door: rev source -> checked AST -> assembly -> machine image. Browser-safe (no Node imports).

import { assemble, type AssembleResult } from '../../asm/src/index.js';
import type { Diagnostic, Program } from './ast.js';
import { check } from './check.js';
import { CompileError, generate } from './codegen.js';
import { layout } from './layout.js';
import { parse } from './parser.js';

/** A declared variable and where it lives. A scalar in a register has `reg > 0`; anything in memory has `addr`. */
export interface Variable {
  name: string;
  /** register number, or 0 when the variable lives in memory */
  reg: number;
  /** data address when it lives in memory */
  addr?: number;
  /** words: 1 for a scalar */
  size: number;
  isArray: boolean;
  init: number[];
  isOut: boolean;
  line: number;
}

export interface CompileResult {
  ok: boolean;
  diagnostics: Diagnostic[];
  program?: Program;
  asm?: string;
  /** asm line (1-based) -> rev source line */
  lineMap?: number[];
  assembled?: AssembleResult;
  image?: Uint8Array;
  vars: Variable[];
}

export function compile(source: string): CompileResult {
  const parsed = parse(source);
  if (!parsed.program) return { ok: false, diagnostics: parsed.diagnostics, vars: [] };
  const program = parsed.program;
  const lay = layout(program);
  const outs = new Set(program.outs.map((o) => o.name));
  const vars: Variable[] = [];
  for (const d of program.vars) {
    const v = lay.vars.get(d.name);
    if (!v || vars.some((x) => x.name === d.name)) continue;
    vars.push(v.kind === 'reg'
      ? { name: d.name, reg: v.reg, size: 1, isArray: false, init: v.init, isOut: outs.has(d.name), line: d.line }
      : { name: d.name, reg: 0, addr: v.addr, size: v.size, isArray: v.isArray, init: v.init, isOut: outs.has(d.name), line: d.line });
  }
  const diagnostics = [...lay.diagnostics, ...check(program, lay.vars)];
  if (diagnostics.length) return { ok: false, diagnostics, program, vars };
  let gen;
  try {
    gen = generate(program, source, lay);
  } catch (e) {
    if (e instanceof CompileError) return { ok: false, diagnostics: [{ line: e.line, message: e.message }], program, vars };
    throw e;
  }
  const assembled = assemble(gen.asm, { fileName: 'out.s' });
  const errors = assembled.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length) {
    // the assembler is a second opinion on the generated code: a diagnostic here is a compiler bug, not a user error
    return {
      ok: false,
      program,
      asm: gen.asm,
      lineMap: gen.lineMap,
      assembled,
      vars,
      diagnostics: errors.map((d) => ({ line: gen.lineMap[d.line - 1] || 0, message: `internal error (generated assembly line ${d.line}): ${d.message}` })),
    };
  }
  return { ok: true, diagnostics: [], program, asm: gen.asm, lineMap: gen.lineMap, assembled, image: assembled.image, vars };
}

export function formatDiagnostics(file: string, ds: Diagnostic[]): string {
  return ds.map((d) => `${file}:${d.line}: error: ${d.message}`).join('\n');
}
