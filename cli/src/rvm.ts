// rvm: one command for the reversible machine.
//   rvm build  prog.(rev|s) -o prog.rvm [--asm out.s]    compile / assemble
//   rvm run    prog.(rev|s) [--engine logging|reversible] run to the halt and print the variables
//   rvm report prog.rev                                   cost report (steps per line, garbage, history, round trip)
//   rvm verify prog.(rev|s)                               check the program against the contract on both engines
//   rvm debug  prog.(rev|s) [--engine ...] [--script "s; s; rwatch x"]   debugger with step back
// From the repo root:  npm run rvm -- <command> ...
import { writeFileSync } from 'node:fs';
import { basename } from 'node:path';

import { createWasmVm } from '../../web/wasm/src/index.js';
import { consoleText } from '../../lang/src/console.js';
import { analyze, formatReport } from '../../lang/src/report.js';
import { Debugger } from './debugger.js';
import { loadFile } from './load.js';
import { repl, runCommand } from './repl.js';
import { formatVerify, verify } from './verify.js';

const args = process.argv.slice(2).filter((a) => a !== '--');
const [command, ...rest] = args;
const valueOpts = new Set(['-o', '--asm', '--engine', '--script', '--max-steps']);
const opt = (name: string): string | undefined => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
const files = rest.filter((a, i) => !a.startsWith('-') && !valueOpts.has(rest[i - 1]));

const usage = (): never => {
  console.error('usage: rvm <build|run|report|verify|debug> prog.(rev|s) [options]   (see cli/README.md)');
  return process.exit(2);
};
if (!command || files.length !== 1) usage();

try {
  const prog = loadFile(files[0]);
  const name = basename(files[0]);
  const engine = (opt('--engine') ?? 'reversible') as 'logging' | 'reversible';
  switch (command) {
    case 'build': {
      const out = opt('-o');
      if (out) writeFileSync(out, prog.image);
      const asmOut = opt('--asm');
      if (asmOut && prog.compiled?.asm) writeFileSync(asmOut, prog.compiled.asm);
      console.log(`${name}: ok, ${prog.codeLength} instructions${out ? `, wrote ${out}` : ''}`);
      break;
    }
    case 'run': {
      const vm = await createWasmVm(engine);
      vm.loadProgram(prog.image);
      let s = 'ok';
      while ((s = vm.stepForward()) === 'ok') { /* run */ }
      console.log(`${name}: ${s} after ${vm.instructionCount} steps on the ${engine} engine, ${vm.historyBytes} bytes of history`);
      if (s === 'fault') console.log(`fault: ${vm.lastError}`);
      const regs = vm.registers().regs;
      if (prog.vars.length) {
        for (const v of prog.vars) {
          const words = v.reg ? [regs[v.reg]] : Array.from(vm.memory(v.addr!, Math.min(v.size, 16)));
          console.log(`  ${(v.isArray ? v.name + '[' + v.size + ']' : v.name).padEnd(12)} ${v.isArray ? '[' + words.join(', ') + (v.size > 16 ? ', ...' : '') + ']' : words[0] | 0}${v.isOut ? '   out' : ''}`);
        }
      }
      else for (let i = 0; i < 16; i++) if (regs[i]) console.log(`  r${i} = ${regs[i] | 0}`);
      const printed = consoleText((a, n) => vm.memory(a, n));
      if (printed) console.log('console:\n' + printed);
      vm.destroy();
      break;
    }
    case 'report': {
      if (prog.kind !== 'rev' || !prog.compiled) throw new Error('report works on .rev programs');
      const r = await analyze(prog.compiled, prog.source, Number(opt('--max-steps') ?? 5_000_000));
      console.log(formatReport(r, name));
      if (r.fault || !r.roundTrip) process.exitCode = 1;
      break;
    }
    case 'verify': {
      const r = await verify(prog, { maxSteps: Number(opt('--max-steps') ?? 200_000) });
      console.log(formatVerify(name, r));
      if (!r.ok) process.exitCode = 1;
      break;
    }
    case 'debug': {
      const vm = await createWasmVm(engine);
      vm.loadProgram(prog.image);
      const dbg = new Debugger(vm, prog);
      const script = opt('--script');
      if (script) {
        console.log(`${name}: ${engine} engine`);
        for (const cmd of script.split(';')) {
          console.log(`(rvm) ${cmd.trim()}`);
          const r = runCommand(dbg, cmd);
          process.stdout.write(r.out);
          if (r.quit) break;
        }
      } else {
        await repl(dbg);
      }
      vm.destroy();
      break;
    }
    default: usage();
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
}
