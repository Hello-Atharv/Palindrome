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

export interface AsmOutcome {
  ok: boolean;
  image?: Uint8Array;
  diagnostics: AsmDiagnostic[];
  listing: AsmListingRow[];
}

export type AssembleFn = (source: string, fileName?: string) => AsmOutcome;

export function formatDiagnostics(name: string, ds: readonly AsmDiagnostic[]): string {
  return ds.map((d) => `${d.line > 0 ? `${name}:${d.line}` : name}: ${d.severity}: ${d.message}`).join('\n');
}
