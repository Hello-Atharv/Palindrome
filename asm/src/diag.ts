export interface Diagnostic {
  severity: 'error' | 'warning';
  /** 1-based source line, or 0 when not tied to a line. */
  line: number;
  message: string;
}

export function formatDiagnostic(file: string, d: Diagnostic): string {
  const where = d.line > 0 ? `${file}:${d.line}` : file;
  return `${where}: ${d.severity}: ${d.message}`;
}
