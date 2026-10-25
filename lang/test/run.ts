// Helpers: compile a rev program and run it on the real engines.
import { createWasmVm, type WasmVm } from '../../web/wasm/src/index.js';
import { compile, type CompileResult } from '../src/compile.js';
import type { State } from './interp.js';

export type Compiled = CompileResult & { image: Uint8Array };

export function mustCompile(src: string): Compiled {
  const r = compile(src);
  if (!r.ok || !r.image) throw new Error(`compile failed:\n${r.diagnostics.map((d) => `line ${d.line}: ${d.message}`).join('\n')}\n${r.asm ?? ''}`);
  return r as Compiled;
}

export interface Ran {
  vm: WasmVm;
  vars: State;
  steps: number;
  status: string;
  /** all writable memory right after the program was loaded */
  startMem: Uint32Array;
}

/** Read every variable (register or memory) back from a machine. */
export function readVars(c: Compiled, vm: WasmVm): State {
  const regs = vm.registers().regs;
  return new Map(c.vars.map((v) => [v.name, v.reg ? [regs[v.reg]] : Array.from(vm.memory(v.addr!, v.size))]));
}

/** Run to the HLT on the given engine, with `input` pushed as key events before the first step. */
export async function run(r: Compiled, kind: 'logging' | 'reversible' = 'reversible', input: number[] = [], maxSteps = 3_000_000): Promise<Ran> {
  const vm = await createWasmVm(kind);
  if (vm.loadProgram(r.image) !== 'ok') throw new Error('load failed');
  const startMem = vm.memory(0, 0x20800);
  for (const v of input) vm.pushInput(v);
  let status = 'ok';
  for (let n = 0; (status = vm.stepForward()) === 'ok'; n++) {
    if (n >= maxSteps) { status = 'limit'; break; } // a runaway program is a failure, not a hang
  }
  return { vm, vars: readVars(r, vm), steps: vm.instructionCount, status, startMem };
}
