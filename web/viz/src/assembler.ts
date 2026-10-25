/**
 * The shape of the assembler hook. web/viz does not import asm/ itself: the page that mounts the shell passes
 * `assemble` in (main.ts wires asm/src/index.ts), so the shell stays testable and the assembler stays swappable.
 */
export interface AsmDiagnostic {
  severity: 'error' | 'warning';
  /** 1-based source line, or 0 when not tied to a line. */
  line: number;
  message: string;
}

export interface AsmListingRow {
  addr: number;
  word: number;
  line: number;
  text: string;
}

/** A variable of a rev program, as the compiler laid it out: lets the UI tell which ones the program keeps only because it cannot erase them. */
export interface ProgramVariable {
  name: string;
  /** register number, or 0 when the variable lives in memory */
  reg: number;
  /** data address when it lives in memory */
  addr?: number;
  /** words: 1 for a scalar */
  size: number;
  /** starting values (an array may list fewer than `size`; the rest start at 0) */
  init: number[];
  /** declared `out`: a result, not garbage */
  isOut: boolean;
}

export interface AsmOutcome {
  ok: boolean;
  image?: Uint8Array;
  diagnostics: AsmDiagnostic[];
  listing: AsmListingRow[];
  /** rev programs only */
  variables?: ProgramVariable[];
}

export type AssembleFn = (source: string, fileName?: string) => AsmOutcome;

export function formatDiagnostics(name: string, ds: readonly AsmDiagnostic[]): string {
  return ds.map((d) => `${d.line > 0 ? `${name}:${d.line}` : name}: ${d.severity}: ${d.message}`).join('\n');
}
