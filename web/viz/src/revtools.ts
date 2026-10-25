/** The rev language's editor support: errors and warnings as you type, and the per-line cost report. All logic lives in lang/; this only calls it. */
import { compile } from '../../../lang/src/compile';
import { analyze, formatReport } from '../../../lang/src/report';

export interface RevDiagnostic {
  severity: 'error' | 'warning';
  line: number;
  message: string;
}

/** Compile without loading anything: the errors and warnings for this text, for the problems list. */
export function checkRev(source: string): RevDiagnostic[] {
  const c = compile(source);
  return [
    ...c.diagnostics.map((d) => ({ severity: 'error' as const, line: d.line, message: d.message })),
    ...c.warnings.map((d) => ({ severity: 'warning' as const, line: d.line, message: d.message })),
  ];
}

/** Steps the cost report runs the program for before it gives up (the report runs the program on both engines). */
const REPORT_STEPS = 400_000;

/** The cost report text for a program that compiles, or '' if it does not. Runs the program, so it is async and only done on Build. */
export async function costReport(source: string, name: string): Promise<string> {
  const c = compile(source);
  if (!c.ok) return '';
  try {
    return formatReport(await analyze(c, source, REPORT_STEPS), name);
  } catch (e) {
    return `cost report unavailable: ${e instanceof Error ? e.message : String(e)}`;
  }
}
