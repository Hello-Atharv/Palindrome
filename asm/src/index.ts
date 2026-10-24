// Public surface of the assembler. Browser-safe: no Node imports here (see cli.ts for the command line tool).
export { assemble } from './assemble.js';
export type { AssembleOptions, AssembleResult, ListingRow, SourceMap, SymbolInfo } from './assemble.js';
export { formatDiagnostic } from './diag.js';
export type { Diagnostic } from './diag.js';
export { COND, OP, decode, encB, encR, encRRR } from './isa.js';
