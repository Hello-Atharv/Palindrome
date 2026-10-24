// Load a program for the tools: a .rev file is compiled, a .s file is assembled. Either way the result carries the image and
// enough debug information (pc -> source line, variable names) for the debugger and the verifier.
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

import { assemble, formatDiagnostic } from '../../asm/src/index.js';
import { compile, formatDiagnostics, type CompileResult } from '../../lang/src/index.js';

export interface DebugVar {
  name: string;
  reg: number;
  isOut: boolean;
}

export interface Loaded {
  kind: 'rev' | 'asm';
  file: string;
  /** the source the user wrote (what line numbers refer to) */
  lines: string[];
  image: Uint8Array;
  /** code address -> source line (1-based) of the user's source */
  pcLine: Map<number, number>;
  vars: DebugVar[];
  codeLength: number;
  compiled?: CompileResult;
  source: string;
}

export function loadSource(file: string, source: string): Loaded {
  const lines = source.split('\n');
  if (extname(file) === '.rev') {
    const c = compile(source);
    if (!c.ok || !c.image || !c.assembled || !c.lineMap) throw new Error(formatDiagnostics(file, c.diagnostics));
    const pcLine = new Map<number, number>();
    for (const [addr, , asmLine] of c.assembled.sourceMap.code) pcLine.set(addr, c.lineMap[asmLine - 1] ?? 0);
    return {
      kind: 'rev', file, lines, image: c.image, pcLine, codeLength: c.assembled.code.length, compiled: c, source,
      vars: c.vars.map((v) => ({ name: v.name, reg: v.reg, isOut: v.isOut })),
    };
  }
  const a = assemble(source, { fileName: file });
  const errors = a.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length || !a.image) throw new Error(errors.map((d) => formatDiagnostic(file, d)).join('\n'));
  const pcLine = new Map<number, number>();
  for (const [addr, , line] of a.sourceMap.code) pcLine.set(addr, line);
  return { kind: 'asm', file, lines, image: a.image, pcLine, codeLength: a.code.length, source, vars: [] };
}

export function loadFile(file: string): Loaded {
  return loadSource(file, readFileSync(file, 'utf8'));
}
