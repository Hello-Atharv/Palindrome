// Helpers: compile a rev program and run it on the real engines.
import { createWasmVm, type WasmVm } from '../../web/wasm/src/index.js';
import { compile, type CompileResult } from '../src/compile.js';

export type Compiled = CompileResult & { image: Uint8Array };

export function mustCompile(src: string): Compiled {
  const r = compile(src);
  if (!r.ok || !r.image) throw new Error(`compile failed:\n${r.diagnostics.map((d) => `line ${d.line}: ${d.message}`).join('\n')}\n${r.asm ?? ''}`);
  return r as Compiled;
}

export interface Ran {
  vm: WasmVm;
  vars: Map<string, number>;
  steps: number;
  status: string;
}

/** Run to the HLT on the given engine and read the variables back from their registers. */
export async function run(r: Compiled, kind: 'logging' | 'reversible' = 'reversible'): Promise<Ran> {
  const vm = await createWasmVm(kind);
  if (vm.loadProgram(r.image) !== 'ok') throw new Error('load failed');
  let status = 'ok';
  while ((status = vm.stepForward()) === 'ok') { /* run */ }
  const regs = vm.registers().regs;
  return { vm, vars: new Map(r.vars.map((v) => [v.name, regs[v.reg]])), steps: vm.instructionCount, status };
}
