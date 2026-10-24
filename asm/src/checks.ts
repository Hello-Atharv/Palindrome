// Static checks of the control-flow rules in spec/SPEC.md section 6. Everything the logging VM would
// fault on at run time because of how the program is laid out is reported here, with a source line.

import type { Diagnostic } from './diag.js';
import { COND, OP, decode } from './isa.js';

export function checkProgram(code: number[], entry: number, lineOf: number[]): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const err = (addr: number, message: string): void => {
    diags.push({ severity: 'error', line: lineOf[addr] ?? 0, message });
  };
  const n = code.length;
  if (n === 0) {
    diags.push({ severity: 'error', line: 0, message: 'the program has no instructions' });
    return diags;
  }
  if (entry >= n) {
    diags.push({ severity: 'error', line: 0, message: 'the entry point is outside the code' });
    return diags;
  }

  const d = code.map(decode);
  const cannotFallThrough = (i: number): boolean =>
    d[i].op === OP.HLT || d[i].op === OP.RET || (d[i].op === OP.BR && d[i].cc === COND.al);
  const claims = new Array<number>(n).fill(0);
  let sawHlt = false;

  for (let a = 0; a < n; a++) {
    const i = d[a];
    switch (i.op) {
      case OP.HLT:
        sawHlt = true;
        break;
      case OP.BR:
        if (i.target >= n || d[i.target].op !== OP.LND || d[i.target].target !== a) {
          err(a, 'a taken br must land on an lnd whose source operand names this br');
        }
        break;
      case OP.LND:
        if (i.target >= n || d[i.target].op !== OP.BR || d[i.target].target !== a) {
          err(a, 'an lnd must name, as its source, a br that jumps to this landing');
        }
        break;
      case OP.CALL:
        if (i.target >= n || d[i.target].op !== OP.PROC) err(a, 'call target must be a proc');
        break;
      case OP.PROC:
        if (i.target >= n || d[i.target].op !== OP.RET) err(a, 'proc must name its ret instruction');
        else {
          claims[i.target]++;
          if (i.target < a) err(a, 'the ret named by proc must come after it');
        }
        if (a === 0) err(a, 'the first instruction cannot be a proc (it would be the entry)');
        else if (!cannotFallThrough(a - 1) && d[a - 1].op !== OP.CALL) {
          err(a, 'a proc can be reached by falling through from the previous instruction; end that block with hlt, ret or br al');
        }
        break;
    }

    if (cannotFallThrough(a) && a + 1 < n && d[a + 1].op !== OP.LND && d[a + 1].op !== OP.PROC) {
      err(a + 1, 'this instruction cannot be reached: the previous instruction never falls through, so it must be an lnd or proc');
    }
  }

  for (let a = 0; a < n; a++) {
    if (d[a].op !== OP.RET) continue;
    if (claims[a] === 0) err(a, 'this ret is not the declared exit of any proc');
    else if (claims[a] > 1) err(a, 'this ret is named by more than one proc (one entry, one exit per procedure)');
  }

  const last = n - 1;
  if (!cannotFallThrough(last)) {
    err(last, 'the program can run off the end of the code; finish with hlt, ret or br al');
  }
  if (d[entry].op === OP.LND || d[entry].op === OP.PROC) {
    err(entry, 'the entry point must not be a jump target (lnd or proc)');
  }
  if (!sawHlt) diags.push({ severity: 'warning', line: 0, message: 'the program contains no hlt' });
  return diags;
}
