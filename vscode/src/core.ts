// The editor-facing logic, with no dependency on the vscode API so it can be tested in Node:
// source text in, diagnostics and per-line costs out.
import { assemble } from '../../asm/src/index.js';
import { compile } from '../../lang/src/compile.js';
import { analyze, formatReport, type Report } from '../../lang/src/report.js';

export interface EditorDiagnostic {
  /** 1-based source line (0 when the message belongs to no line) */
  line: number;
  message: string;
  severity: 'error' | 'warning';
}

/** Compile (or assemble) only: instant, used while typing. */
export function diagnose(language: 'rev' | 'rvm-asm', source: string): EditorDiagnostic[] {
  if (language === 'rev') {
    const c = compile(source);
    return [
      ...c.diagnostics.map((d) => ({ line: d.line, message: d.message, severity: 'error' as const })),
      ...c.warnings.map((d) => ({ line: d.line, message: d.message, severity: 'warning' as const })),
    ];
  }
  return assemble(source).diagnostics.map((d) => ({ line: d.line, message: d.message, severity: d.severity }));
}

export interface LineCost {
  line: number;
  steps: number;
  /** share of all steps, 0..100 */
  percent: number;
  instructions: number;
}

export interface Costs {
  diagnostics: EditorDiagnostic[];
  lines: LineCost[];
  /** one line for a status bar */
  summary: string;
  /** the full text report */
  report: string;
  ok: boolean;
}

/** Compile and run a rev program on both engines: per-line cost, garbage, history, round trip. */
export async function cost(source: string, maxSteps = 400_000): Promise<Costs> {
  const c = compile(source);
  if (!c.ok) {
    const diagnostics = c.diagnostics.map((d) => ({ line: d.line, message: d.message, severity: 'error' as const }));
    return { diagnostics, lines: [], summary: `rev: ${diagnostics.length} error${diagnostics.length === 1 ? '' : 's'}`, report: diagnostics.map((d) => `line ${d.line}: ${d.message}`).join('\n'), ok: false };
  }
  const r = await analyze(c, source, maxSteps);
  return {
    diagnostics: [
      ...(r.fault ? [{ line: 0, message: r.fault, severity: 'error' as const }] : []),
      ...c.warnings.map((d) => ({ line: d.line, message: d.message, severity: 'warning' as const })),
    ],
    lines: r.lines.filter((l) => l.steps > 0).map((l) => ({
      line: l.line,
      steps: l.steps,
      percent: (100 * l.steps) / Math.max(1, r.steps),
      instructions: l.instructions,
    })),
    summary: summarise(r),
    report: formatReport(r, 'program.rev'),
    ok: !r.fault && r.roundTrip,
  };
}

function summarise(r: Report): string {
  const garbage = !r.outsDeclared ? 'garbage not assessed' : r.garbageVars.length ? `garbage ${r.garbageSignificantBits} bits (${r.garbageVars.join(', ')})` : 'no garbage';
  return `rev: ${r.steps.toLocaleString('en-GB')} steps, ${r.reversibleHistoryBytes} B history (diary would need ${r.diaryBytes.toLocaleString('en-GB')} B), ${garbage}, ${r.roundTrip ? 'undo verified' : 'ROUND TRIP FAILED'}`;
}

/** Text shown after a source line: "477 steps, 1.9%". */
export function lensText(l: LineCost): string {
  const pct = l.percent >= 0.1 ? `${l.percent.toFixed(1)}%` : '<0.1%';
  return `${l.steps.toLocaleString('en-GB')} steps, ${pct}`;
}
