// The compiler front door: rev source -> checked AST -> assembly -> machine image. Browser-safe (no Node imports).

import { assemble, type AssembleResult } from '../../asm/src/index.js';
import type { Diagnostic, Program } from './ast.js';
import { check } from './check.js';
import { CompileError, generate } from './codegen.js';
import { parse } from './parser.js';

export interface Variable {
  name: string;
  reg: number;
  init: number;
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
  const diagnostics = check(program);
  const outs = new Set(program.outs.map((o) => o.name));
  const vars: Variable[] = program.vars.map((v, i) => ({ name: v.name, reg: i + 1, init: v.init, isOut: outs.has(v.name), line: v.line }));
  if (diagnostics.length) return { ok: false, diagnostics, program, vars };
  let gen;
  try {
    gen = generate(program, source);
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
