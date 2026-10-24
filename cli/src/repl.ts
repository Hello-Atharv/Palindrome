// Text commands for the debugger. `runCommand` turns one command line into output text, so it can be tested and driven from
// a script; `repl` wraps it in a prompt.
import { createInterface } from 'node:readline';

import { Debugger, type Stop, type Where, type WatchHit } from './debugger.js';

const hex = (x: number): string => (x > 9999 ? '0x' + x.toString(16) : String(x | 0));

const HELP = `commands (a count may follow s, b, si, bi):
  s [n]        step forward one source line          b [n]        step BACK one source line
  n            next: like s but steps over calls     c            continue forward      rc   continue BACKWARD
  si [n]       one machine instruction forward       bi [n]       one machine instruction back
  break N      stop at source line N                 delete N     remove it             info break
  watch X      run forward until X changes           rwatch X     run BACKWARD until X changes: who wrote it?
  goto T       jump to machine time T (either way)   where        time, line, next instruction
  p [X]        print variables, or X                 regs         registers          mem A [n]   memory words
  list [N]     source around line N (default: here)  history      history bytes the machine keeps
  help, quit
X is a variable name, r0..r15, or [address].`;

function describe(w: Where): string {
  const where = w.line ? `line ${w.line}: ${w.text}` : `pc ${w.pc}`;
  return `t=${w.t}  ${where}`;
}

function why(stop: Stop, dbg: Debugger): string {
  switch (stop) {
    case 'done': return '';
    case 'breakpoint': return 'hit a breakpoint\n';
    case 'watch': return '';
    case 'halted': return 'the program has halted\n';
    case 'at_start': return 'at the start of the program (t=0)\n';
    case 'fault': return `fault: ${dbg.vm.lastError}\n`;
    case 'limit': return 'gave up after a million steps\n';
  }
}

function listing(dbg: Debugger, centre: number): string {
  const here = dbg.where().line;
  const lo = Math.max(1, centre - 5);
  const hi = Math.min(dbg.info.lines.length, centre + 5);
  const out: string[] = [];
  for (let l = lo; l <= hi; l++) {
    const mark = l === here ? '=>' : dbg.breakpoints.has(l) ? ' *' : '  ';
    out.push(`${mark} ${String(l).padStart(4)}  ${dbg.info.lines[l - 1]}`);
  }
  return out.join('\n') + '\n';
}

function hit(h: WatchHit, name: string, backwards: boolean): string {
  const verb = backwards ? 'was last written by' : 'was changed by';
  const w = h.writer;
  return (
    `${name} ${verb} ${w.line ? `line ${w.line}: ${w.text}` : `the instruction at pc ${w.pc}`}\n` +
    `  ${hex(h.before)} -> ${hex(h.after)};  machine is now at t=${backwards ? h.t : h.t}${backwards ? ' (just before the write)' : ' (just after it)'}\n`
  );
}

export function runCommand(dbg: Debugger, input: string): { out: string; quit: boolean } {
  const [cmd, ...rest] = input.trim().split(/\s+/);
  const arg = rest.join(' ');
  const count = Math.max(1, Number(rest[0]) || 1);
  let out = '';
  const finish = (stop: Stop): string => why(stop, dbg) + describe(dbg.where()) + '\n';
  const repeat = (f: () => Stop): Stop => {
    let s: Stop = 'done';
    for (let i = 0; i < count && s === 'done'; i++) s = f();
    return s;
  };
  try {
    switch (cmd) {
      case '': return { out: '', quit: false };
      case 'help': case 'h': case '?': return { out: HELP + '\n', quit: false };
      case 'quit': case 'q': case 'exit': return { out: '', quit: true };
      case 's': case 'step': out = finish(repeat(() => dbg.stepLine())); break;
      case 'b': case 'back': out = finish(repeat(() => dbg.backLine())); break;
      case 'n': case 'next': out = finish(repeat(() => dbg.nextLine())); break;
      case 'si': out = finish(repeat(() => dbg.stepInstruction())); break;
      case 'bi': out = finish(repeat(() => dbg.backInstruction())); break;
      case 'c': case 'continue': out = finish(dbg.cont()); break;
      case 'rc': case 'reverse-continue': out = finish(dbg.rcont()); break;
      case 'goto': {
        const t = Number(arg);
        if (!Number.isInteger(t) || t < 0) return { out: 'goto needs a machine time, like: goto 12\n', quit: false };
        out = finish(dbg.goto(t));
        break;
      }
      case 'where': case 'w': out = describe(dbg.where()) + '\n'; break;
      case 'break': case 'br': {
        const l = Number(arg);
        if (!Number.isInteger(l) || l < 1 || l > dbg.info.lines.length) return { out: 'break needs a source line number\n', quit: false };
        dbg.breakpoints.add(l);
        out = `breakpoint at line ${l}: ${dbg.info.lines[l - 1].trim()}\n`;
        break;
      }
      case 'delete': case 'del': dbg.breakpoints.delete(Number(arg)); out = 'ok\n'; break;
      case 'info': out = dbg.breakpoints.size ? `breakpoints: lines ${[...dbg.breakpoints].sort((a, b) => a - b).join(', ')}\n` : 'no breakpoints\n'; break;
      case 'watch': case 'rwatch': {
        if (!arg) return { out: `${cmd} needs something to watch: a variable, r0..r15 or [address]\n`, quit: false };
        const back = cmd === 'rwatch';
        const get = dbg.target(arg);
        const r = back ? dbg.reverseWatch(get) : dbg.forwardWatch(get);
        out = r.hit ? hit(r.hit, arg, back) : `${why(r.stop, dbg)}${arg} did not change before that\n`;
        out += describe(dbg.where()) + '\n';
        break;
      }
      case 'p': case 'print': {
        if (arg) {
          const v = dbg.target(arg)();
          out = `${arg} = ${hex(v)} (${v >>> 0})\n`;
        } else if (dbg.info.vars.length) {
          out = dbg.variables().map((v) => {
            const shown = v.isArray
              ? `${(v.name + '[' + v.words.length + ']').padEnd(10)} [${v.words.slice(0, 8).map(hex).join(', ')}${v.words.length > 8 ? ', ...' : ''}]`
              : `${v.name.padEnd(10)} ${hex(v.words[0]).padStart(12)}`;
            return shown + (v.isOut ? '   out' : '');
          }).join('\n') + '\n';
        } else {
          out = 'no named variables in an assembly program; try: regs\n';
        }
        break;
      }
      case 'regs': {
        const r = dbg.vm.registers();
        const rows: string[] = [];
        for (let i = 0; i < 16; i += 4) rows.push([0, 1, 2, 3].map((k) => `r${i + k}=${hex(r.regs[i + k])}`.padEnd(18)).join(''));
        out = rows.join('\n') + `\npc=${r.pc}  t=${dbg.t}\n`;
        break;
      }
      case 'mem': {
        const [a, n] = rest.map(Number);
        if (!Number.isInteger(a)) return { out: 'mem needs an address, like: mem 0x20000 8\n', quit: false };
        const words = Array.from(dbg.vm.memory(a, n || 4));
        out = words.map((w, i) => `[${hex(a + i)}] = ${hex(w)}`).join('\n') + '\n';
        break;
      }
      case 'list': case 'l': out = listing(dbg, Number(arg) || dbg.where().line || 1); break;
      case 'history':
        out = `the ${dbg.vm.kind} engine is keeping ${dbg.vm.historyBytes} bytes of history for ${dbg.t} steps\n`;
        break;
      default: out = `unknown command '${cmd}' (try: help)\n`;
    }
  } catch (e) {
    out = `${(e as Error).message}\n`;
  }
  return { out, quit: false };
}

/** Interactive loop (also reads piped input). */
export async function repl(dbg: Debugger): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '(rvm) ', terminal: false });
  const interactive = process.stdin.isTTY;
  console.log(`${dbg.info.file}: ${dbg.vm.kind} engine, t=${dbg.t}.  Type help.`);
  console.log(describe(dbg.where()));
  if (interactive) rl.prompt();
  for await (const line of rl) {
    if (!interactive) console.log(`(rvm) ${line}`);
    const r = runCommand(dbg, line);
    process.stdout.write(r.out);
    if (r.quit) break;
    if (interactive) rl.prompt();
  }
  rl.close();
}
