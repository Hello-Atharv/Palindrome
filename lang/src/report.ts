// The cost report (stage 2): run a compiled rev program on the real engines and say what it cost, per source line.
// Node only (it loads the WebAssembly engines).
//
// What it reports, in the vocabulary of SPEC section 12:
//   steps            instructions executed to the halt, and how many each source line caused
//   undo steps       the same number again: every step is undone by exactly one inverse step, with no history
//   diary bytes      what the logging engine had to remember for the same run (48 bytes a step), against 0 for the reversible one
//   garbage          variables that end changed and non-zero but are not declared `out`: information the program could not get rid of
//                    (an input that was never touched is not garbage)
//   round trip       the run was undone step by step to t = 0 and replayed to the end, with identical states each way

import { createWasmVm } from '../../web/wasm/src/index.js';
import type { CompileResult } from './compile.js';
import { consoleText, readConsole } from './console.js';

export interface LineCost {
  line: number;
  text: string;
  /** machine instructions generated for this line */
  instructions: number;
  /** machine steps executed for this line in the run */
  steps: number;
}

export interface VarResult {
  name: string;
  /** one word for a scalar, the whole array otherwise */
  initial: number[];
  final: number[];
  isArray: boolean;
  isOut: boolean;
}

export interface Report {
  steps: number;
  codeWords: number;
  haltStatus: string;
  lines: LineCost[];
  vars: VarResult[];
  /** declared outputs exist, so garbage can be assessed */
  outsDeclared: boolean;
  garbageVars: string[];
  /** SPEC 12.1 upper bound: 32 bits per garbage variable */
  garbageBits: number;
  /** the garbage variables' significant bits (a flag holding 1 is 1 bit): closer to the information actually kept */
  garbageSignificantBits: number;
  /** temporaries left non-zero (a compiler bug if any) */
  dirtyRegisters: number[];
  diaryBytes: number;
  reversibleHistoryBytes: number;
  roundTrip: boolean;
  /** what the program printed (SPEC 11.9) and how many entries; the console is garbage: it can only be stepped back */
  console: string;
  consoleEntries: number;
  /** if statements whose fi was inferred (free: the test survives the branches) and written by hand */
  inferredFis: number;
  explicitFis: number;
  /** `fault` text if the logging engine rejected an assertion */
  fault?: string;
}

export async function analyze(c: CompileResult, source: string, maxSteps = 5_000_000): Promise<Report> {
  if (!c.ok || !c.image || !c.assembled || !c.lineMap) throw new Error('analyze: the program did not compile');
  const srcLines = source.split('\n');

  // asm code address -> rev source line
  const pcLine = new Map<number, number>();
  for (const [addr, , asmLine] of c.assembled.sourceMap.code) pcLine.set(addr, c.lineMap[asmLine - 1] ?? 0);

  const logging = await createWasmVm('logging');
  const reversible = await createWasmVm('reversible');
  try {
    if (logging.loadProgram(c.image) !== 'ok' || reversible.loadProgram(c.image) !== 'ok') throw new Error('load failed');

    const perLine = new Map<number, { instructions: number; steps: number }>();
    const bucket = (l: number): { instructions: number; steps: number } => {
      let b = perLine.get(l);
      if (!b) perLine.set(l, (b = { instructions: 0, steps: 0 }));
      return b;
    };
    for (const l of pcLine.values()) bucket(l).instructions++;

    // run the logging engine first: it checks every landing assertion
    let status = 'ok';
    let fault: string | undefined;
    while (logging.instructionCount < maxSteps) {
      const pc = logging.registers().pc;
      status = logging.stepForward();
      if (status !== 'ok') break;
      bucket(pcLine.get(pc) ?? 0).steps++;
    }
    if (status === 'fault') fault = logging.lastError;
    else if (status === 'ok') fault = `stopped after ${maxSteps} steps without halting`;
    const steps = logging.instructionCount;

    // the reversible engine: same run, then back to the start and forward again
    const MEM = 0x20800; // data + stack + framebuffer
    const startMem = reversible.memory(0, MEM);
    const sameWords = (a: Uint32Array, b: Uint32Array): boolean => a.every((x, i) => x === b[i]);
    while (reversible.instructionCount < steps && reversible.stepForward() === 'ok') { /* same steps */ }
    const finalRegs = Array.from(reversible.registers().regs);
    const finalMem = reversible.memory(0, MEM);
    const loggingRegs = Array.from(logging.registers().regs);
    let roundTrip = finalRegs.every((x, i) => x === loggingRegs[i]) && sameWords(finalMem, logging.memory(0, MEM));
    if (roundTrip) {
      roundTrip = reversible.runTo(0) === 'ok' && reversible.registers().regs.every((x, i) => x === (i === 14 ? 0x10000 : 0)) && sameWords(reversible.memory(0, MEM), startMem);
      roundTrip = roundTrip && reversible.runTo(steps) === 'ok' && Array.from(reversible.registers().regs).every((x, i) => x === finalRegs[i]) && sameWords(reversible.memory(0, MEM), finalMem);
    }

    const vars: VarResult[] = c.vars.map((v) => ({
      name: v.name,
      isOut: v.isOut,
      isArray: v.isArray,
      initial: Array.from({ length: v.size }, (_, i) => (v.init[i] ?? 0) >>> 0),
      final: v.reg ? [finalRegs[v.reg]] : Array.from(finalMem.slice(v.addr!, v.addr! + v.size)),
    }));
    const outsDeclared = c.vars.some((v) => v.isOut);
    const changed = (v: VarResult): boolean => v.final.some((x) => x !== 0) && v.final.some((x, i) => x !== v.initial[i]);
    const garbageVars = outsDeclared ? vars.filter((v) => !v.isOut && changed(v)).map((v) => v.name) : [];
    const used = new Set(c.vars.map((v) => v.reg));
    const dirtyRegisters: number[] = [];
    for (let r = 1; r <= 15; r++) if (r !== 14 && !used.has(r) && finalRegs[r] !== 0) dirtyRegisters.push(r);

    const lines: LineCost[] = [...perLine.entries()]
      .filter(([l]) => l > 0)
      .sort((a, b) => a[0] - b[0])
      .map(([line, b]) => ({ line, text: (srcLines[line - 1] ?? '').trim(), instructions: b.instructions, steps: b.steps }));

    return {
      steps,
      codeWords: c.assembled.code.length,
      haltStatus: status,
      lines,
      vars,
      outsDeclared,
      garbageVars,
      garbageBits: vars.filter((v) => garbageVars.includes(v.name)).reduce((n, v) => n + 32 * v.final.filter((x) => x !== 0).length, 0),
      garbageSignificantBits: vars.filter((v) => garbageVars.includes(v.name)).reduce((n, v) => n + v.final.reduce((m, x) => m + (32 - Math.clz32(x)), 0), 0),
      dirtyRegisters,
      diaryBytes: logging.historyBytes,
      reversibleHistoryBytes: reversible.historyBytes,
      roundTrip,
      console: consoleText((a, n) => finalMem.slice(a, a + n)),
      consoleEntries: readConsole((a, n) => finalMem.slice(a, a + n)).length,
      inferredFis: c.inferredFis.length,
      explicitFis: c.explicitFis.length,
      fault,
    };
  } finally {
    logging.destroy();
    reversible.destroy();
  }
}

const hex = (x: number): string => (x > 9999 ? '0x' + x.toString(16) : String(x | 0));

export function formatReport(r: Report, file: string): string {
  const o: string[] = [];
  const total = Math.max(1, r.steps);
  o.push(`${file}: ${r.codeWords} machine instructions, ${r.steps.toLocaleString('en-GB')} steps to halt`);
  if (r.fault) o.push(`  !! ${r.fault}`);
  o.push('');
  o.push('cost by source line (steps = machine instructions executed; undoing a line costs the same number of inverse steps)');
  o.push('  line   instr    steps      %   source');
  for (const l of r.lines) {
    const pct = ((100 * l.steps) / total).toFixed(1).padStart(5);
    o.push(`  ${String(l.line).padStart(4)}  ${String(l.instructions).padStart(6)}  ${String(l.steps).padStart(7)}  ${pct}   ${l.text}`);
  }
  o.push('');
  o.push('variables           initial        final   role');
  for (const v of r.vars) {
    const zero = v.final.every((x) => x === 0);
    const same = v.final.every((x, i) => x === v.initial[i]);
    const role = !r.outsDeclared ? '' : v.isOut ? 'out' : zero ? 'cleared' : same ? 'input (unchanged)' : 'GARBAGE';
    if (!v.isArray) {
      o.push(`  ${v.name.padEnd(12)} ${hex(v.initial[0]).padStart(10)} ${hex(v.final[0]).padStart(12)}   ${role}`);
    } else {
      const show = (a: number[]): string => '[' + a.slice(0, 8).map(hex).join(', ') + (a.length > 8 ? `, ... ${a.length} words` : '') + ']';
      o.push(`  ${(v.name + '[' + v.final.length + ']').padEnd(12)} ${show(v.initial)}`);
      o.push(`  ${''.padEnd(12)} -> ${show(v.final)}   ${role}`);
    }
  }
  o.push('');
  o.push('what it cost to be able to go back');
  o.push(`  machine history, reversible engine   ${r.reversibleHistoryBytes} bytes`);
  o.push(`  machine history, logging engine      ${r.diaryBytes.toLocaleString('en-GB')} bytes (48 per step; a naive diary, see spec section 12)`);
  if (!r.outsDeclared) o.push('  garbage                              not assessed (no `out` declaration)');
  else if (r.garbageVars.length === 0) o.push('  garbage                              none: every non-output variable is back to zero');
  else o.push(`  garbage                              ${r.garbageVars.join(', ')}  (${r.garbageSignificantBits} significant bits; spec upper bound ${r.garbageBits})`);
  if (r.consoleEntries > 0) o.push(`  console output                       ${r.consoleEntries} entries = ${r.consoleEntries * 2} words of garbage: ${JSON.stringify(r.console)}`);
  if (r.inferredFis + r.explicitFis > 0) {
    o.push(`  if statements                        ${r.inferredFis} with an inferred fi (free), ${r.explicitFis} with a written fi (a flag or another condition: look for garbage above)`);
  }
  o.push(`  temporaries left behind              ${r.dirtyRegisters.length === 0 ? 'none' : 'r' + r.dirtyRegisters.join(', r') + '  (compiler bug)'}`);
  o.push(`  round trip                           ${r.roundTrip ? `verified: undone step by step to t=0 and replayed ${r.steps} steps, identical states` : 'FAILED'}`);
  return o.join('\n');
}
