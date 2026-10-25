// Measures what each demo program needs: code, data, registers, stack depth, steps, history.
//   npx vite-node scripts/footprint.ts
import { assemble } from '../../../asm/src/index';
import cipher from '../../../examples/demos/cipher.s?raw';
import sort from '../../../examples/demos/sort.s?raw';
import call from '../../../examples/asm/call.s?raw';
import ifelse from '../../../examples/asm/ifelse.s?raw';
import ifelseMacro from '../../../examples/asm/ifelse_macro.s?raw';
import loop from '../../../examples/asm/loop.s?raw';
import loopMacro from '../../../examples/asm/loop_macro.s?raw';
import memory from '../../../examples/asm/memory.s?raw';
import nested from '../../../examples/asm/nested.s?raw';
import { createWasmVm } from '../../wasm/src/index';

const SP0 = 0x10000;
const DATA_SCAN = 4096; // words of data space watched (the demos use far fewer)
const STACK_SCAN = 256;

const programs: [string, string][] = [
  ['ifelse.s', ifelse], ['ifelse_macro.s', ifelseMacro], ['loop.s', loop], ['loop_macro.s', loopMacro],
  ['nested.s', nested], ['call.s', call], ['memory.s', memory], ['sort.s', sort], ['cipher.s', cipher],
];

const rows: string[][] = [];
for (const [name, src] of programs) {
  const asm = assemble(src);
  if (!asm.ok || !asm.image) throw new Error(`${name}: ${asm.diagnostics.map((d) => d.message).join('; ')}`);
  const vm = await createWasmVm('logging');
  vm.loadProgram(asm.image);

  const touchedRegs = new Set<number>();
  const everData = new Set<number>();
  let peakData = 0;
  let maxSp = SP0;
  let prev = Array.from(vm.registers().regs);
  let steps = 0;
  while (vm.stepForward() === 'ok' && steps < 100000) {
    steps++;
    const r = vm.registers().regs;
    for (let i = 0; i < 16; i++) if (r[i] !== prev[i]) touchedRegs.add(i);
    prev = Array.from(r);
    maxSp = Math.max(maxSp, r[14]);
    const d = vm.memory(0, DATA_SCAN);
    let nz = 0;
    for (let i = 0; i < d.length; i++) if (d[i] !== 0) { nz++; everData.add(i); }
    peakData = Math.max(peakData, nz);
  }
  const end = vm.memory(0, DATA_SCAN).reduce((n, w) => n + (w !== 0 ? 1 : 0), 0);
  const stackWords = maxSp - SP0;
  const stackTouched = vm.memory(SP0, STACK_SCAN).reduce((n, w) => n + (w !== 0 ? 1 : 0), 0);
  const fb = vm.framebuffer().reduce((n, w) => n + (w !== 0 ? 1 : 0), 0);
  const regs = [...touchedRegs].filter((i) => i !== 14).sort((a, b) => a - b);
  rows.push([
    name, String(asm.code.length), String(asm.data.length), String(end), String(peakData), String(stackWords), String(stackTouched),
    regs.length ? `${regs.length}: ${regs.map((i) => 'r' + i).join(' ')}` : '0', String(fb), String(steps), `${((steps * 48) / 1024).toFixed(1)} KiB`,
  ]);
  vm.destroy();
}

const head = ['program', 'code', 'data', 'nonzero@end', 'peak nonzero', 'stack depth', 'stack left', 'registers written', 'pixels', 'steps', 'diary history'];
const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
const line = (r: string[]) => r.map((c, i) => c.padEnd(w[i])).join('  ');
console.log(line(head));
console.log(w.map((n) => '-'.repeat(n)).join('  '));
for (const r of rows) console.log(line(r));
