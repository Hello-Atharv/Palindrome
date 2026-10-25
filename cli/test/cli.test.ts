import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';

import { createWasmVm, type WasmVm } from '../../web/wasm/src/index.js';
import { Debugger } from '../src/debugger.js';
import { loadFile, loadSource } from '../src/load.js';
import { runCommand } from '../src/repl.js';
import { verify } from '../src/verify.js';

const repo = (p: string): string => new URL(`../../${p}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const made: WasmVm[] = [];
afterAll(() => made.forEach((v) => v.destroy()));

async function debuggerFor(file: string, kind: 'logging' | 'reversible' = 'reversible'): Promise<Debugger> {
  const info = loadFile(repo(file));
  const vm = await createWasmVm(kind);
  made.push(vm);
  expect(vm.loadProgram(info.image)).toBe('ok');
  return new Debugger(vm, info);
}

const script = (d: Debugger, cmds: string): string => cmds.split(';').map((c) => runCommand(d, c).out).join('');

describe('debugger', () => {
  it('steps by source line and back again, landing where it started', async () => {
    const d = await debuggerFor('examples/rev/fib.rev');
    const w0 = d.where();
    for (let i = 0; i < 6; i++) expect(d.stepLine()).toBe('done');
    const w6 = d.where();
    expect(w6.t).toBeGreaterThan(w0.t);
    for (let i = 0; i < 6; i++) expect(d.backLine()).toBe('done');
    expect(d.where()).toEqual(w0);
    for (let i = 0; i < 6; i++) d.stepLine();
    expect(d.where()).toEqual(w6); // forward again reproduces the same places
  });

  it('next steps over a call, step goes into it', async () => {
    const d = await debuggerFor('examples/rev/fib.rev');
    const callLine = 13;
    d.breakpoints.add(callLine);
    expect(d.cont()).toBe('breakpoint');
    expect(d.where().line).toBe(callLine);
    const sp = d.vm.registers().regs[14];
    expect(d.nextLine()).toBe('done');
    expect(d.vm.registers().regs[14]).toBe(sp); // still in main, the call ran to completion
    expect(d.where().line).toBe(14);
    d.goto(d.t - 1 - 0); // back to just before `i += 1`
    d.breakpoints.clear();
    // stepping from the call line with `s` enters the procedure
    const d2 = await debuggerFor('examples/rev/fib.rev');
    d2.breakpoints.add(callLine);
    d2.cont();
    expect(d2.stepLine()).toBe('done');
    expect(d2.vm.registers().regs[14]).toBeGreaterThan(sp); // inside `step`
  });

  it('reverse watchpoint finds the line that last wrote a variable, exactly', async () => {
    const d = await debuggerFor('examples/rev/sort3.rev');
    expect(d.cont()).toBe('halted');
    const endT = d.t;
    const flag = d.target('f2');
    expect(flag()).toBe(1);
    const { hit, stop } = d.reverseWatch(flag);
    expect(stop).toBe('watch');
    expect(hit!.writer.line).toBe(9); // `if (b > c) { b <=> c; f2 += 1; } ...`
    expect([hit!.before, hit!.after]).toEqual([0, 1]);
    expect(flag()).toBe(0); // the machine is now before the write
    // stepping one instruction forward executes exactly that write
    expect(d.stepInstruction()).toBe('done');
    expect(flag()).toBe(1);
    // and going all the way forward again reaches the same final time
    expect(d.cont()).toBe('halted');
    expect(d.t).toBe(endT);
  });

  it('forward watch stops just after the change', async () => {
    const d = await debuggerFor('examples/rev/fib.rev');
    const { hit } = d.forwardWatch(d.target('i'));
    expect(hit!.writer.line).toBe(14);
    expect([hit!.before, hit!.after]).toEqual([0, 1]);
  });

  it('continue and reverse-continue are mirror images', async () => {
    const d = await debuggerFor('examples/rev/sort3.rev');
    expect(d.cont()).toBe('halted');
    const end = d.where();
    expect(d.rcont()).toBe('at_start');
    expect(d.t).toBe(0);
    expect(d.cont()).toBe('halted');
    expect(d.where()).toEqual(end);
  });

  it('breakpoints stop in both directions', async () => {
    const d = await debuggerFor('examples/rev/sort3.rev');
    d.breakpoints.add(9);
    expect(d.cont()).toBe('breakpoint');
    expect(d.where().line).toBe(9);
    d.breakpoints.clear();
    d.cont();
    d.breakpoints.add(8);
    expect(d.rcont()).toBe('breakpoint');
    expect(d.where().line).toBe(8);
  });

  it('a breakpoint fires on arriving at its line, not at every instruction of it', async () => {
    const d = await debuggerFor('examples/rev/sort3.rev');
    d.breakpoints.add(8);
    expect(d.cont()).toBe('breakpoint');
    expect(d.where().line).toBe(8);
    // standing on the breakpoint, one step runs the whole line and moves on (it used to stay stuck on line 8)
    expect(d.stepLine()).toBe('done');
    expect(d.where().line).toBe(9);
    // and continuing from a breakpoint does not stop at it again straight away
    d.breakpoints.add(8);
    expect(d.cont()).toBe('halted');
  });

  it('a breakpoint inside a loop fires once per pass', async () => {
    const d = await debuggerFor('examples/rev/fib.rev');
    d.breakpoints.add(13); // call step; (ten passes)
    let hits = 0;
    while (d.cont() === 'breakpoint') {
      hits++;
      expect(d.where().line).toBe(13);
    }
    expect(hits).toBe(10);
    // going back through the loop fires it once per pass too
    let backHits = 0;
    while (d.rcont() === 'breakpoint') backHits++;
    expect(backHits).toBe(10);
  });

  it('gives the same transcript on both engines (apart from the history line)', async () => {
    const cmds = 'list;s;s;n;p;rwatch f1;p f1;b;c;rc;goto 7;where;regs;mem 0 2;watch a;si 3;bi 2;info;break 9;c;p';
    const a = script(await debuggerFor('examples/rev/sort3.rev', 'logging'), cmds);
    const b = script(await debuggerFor('examples/rev/sort3.rev', 'reversible'), cmds);
    expect(a).toBe(b);
    expect(a).toMatch(/was last written by line 8/);
  });

  it('works on plain assembly too (lines are the .s lines)', async () => {
    const d = await debuggerFor('examples/asm/loop_macro.s');
    expect(d.cont()).toBe('halted');
    const r3 = d.target('r3');
    expect(r3()).toBe(16); // r3 += r1 (= 4), four times
    const { hit } = d.reverseWatch(r3);
    expect(hit!.writer.line).toBeGreaterThan(0);
    expect([hit!.before, hit!.after]).toEqual([12, 16]);
  });

  it('ignores comments after a # so annotated command lists can be pasted', async () => {
    const d = await debuggerFor('examples/rev/sort3.rev');
    expect(runCommand(d, 'c   # run to the end').out).toMatch(/halted/);
    expect(runCommand(d, 'p f1   # now 1').out).toBe('f1 = 1 (1)\n');
    expect(runCommand(d, '# only a comment').out).toBe('');
    expect(runCommand(d, 'rwatch f1  # who wrote it?').out).toMatch(/f1 was last written by line 8/);
  });

  it('explains bad input instead of crashing', async () => {
    const d = await debuggerFor('examples/rev/fib.rev');
    expect(runCommand(d, 'watch nonsense').out).toMatch(/don't know what/);
    expect(runCommand(d, 'frobnicate').out).toMatch(/unknown command/);
    expect(runCommand(d, 'goto banana').out).toMatch(/machine time/);
    expect(runCommand(d, 'quit').quit).toBe(true);
  });
});

describe('verify', () => {
  it('passes the example programs', async () => {
    for (const f of ['examples/rev/fib.rev', 'examples/rev/sort3.rev', 'examples/asm/nested.s', 'examples/asm/call.s', 'examples/asm/bennett.s']) {
      const r = await verify(loadFile(repo(f)));
      expect(r.ok, `${f}: ${JSON.stringify(r.checks.filter((c) => !c.ok))}`).toBe(true);
      expect(r.steps).toBeGreaterThan(0);
    }
  });

  it('passes the demo programs: cipher, sort and pong (which halts at game over without input)', async () => {
    for (const f of ['examples/demos/cipher.s', 'examples/demos/sort.s', 'examples/demos/pong.s']) {
      const r = await verify(loadFile(repo(f)), { maxSteps: 100_000 });
      expect(r.ok, `${f}: ${JSON.stringify(r.checks.filter((c) => !c.ok))}`).toBe(true);
    }
  }, 120_000);

  it('fails a program whose landing assertion is wrong', async () => {
    const bad = `
start:  addi r1, 5
        addi r2, 5
        .if  eq, r1, r2
        addi r3, 7
        .else
        addi r3, 100
        .fi  eq, r1, r2
        hlt
`;
    const r = await verify(loadSource('bad.s', bad));
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.name === 'assertions')!.ok).toBe(false);
  });

  it('fails a program that does not halt within the step limit', async () => {
    const long = ['start: addi r1, 100000', ' .loop ne, r2, r0', ' addi r2, 1', ' .again ne, r2, r1', ' hlt', ''].join('\n');
    const r = await verify(loadSource('long.s', long), { maxSteps: 500 });
    expect(r.ok).toBe(false);
  });
});

describe('sanity', () => {
  it('the example files exist', () => {
    expect(readFileSync(repo('examples/rev/fib.rev'), 'utf8')).toMatch(/Fibonacci/);
  });
});
