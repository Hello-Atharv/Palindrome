import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';

import { assemble } from '../../../asm/src/index.js';
import { createWasmVm, wasmVersion, type WasmVm } from '../src/index.js';

const example = (name: string): string =>
  readFileSync(new URL(`../../../asm/examples/${name}`, import.meta.url), 'utf8');
const image = (src: string): Uint8Array => {
  const r = assemble(src);
  expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return r.image!;
};

const made: WasmVm[] = [];
async function vm(kind: 'logging' | 'reversible', src: string): Promise<WasmVm> {
  const v = await createWasmVm(kind);
  made.push(v);
  expect(v.loadProgram(image(src))).toBe('ok');
  return v;
}
afterAll(() => made.forEach((v) => v.destroy()));

const runToEnd = (v: WasmVm): string => {
  let s;
  while ((s = v.stepForward()) === 'ok') {}
  return s;
};

describe('the wasm build', () => {
  it('reports its version', async () => {
    expect(await wasmVersion()).toMatch(/^rvm /);
  });

  for (const kind of ['logging', 'reversible'] as const) {
    describe(`${kind} engine`, () => {
      it('runs ifelse.s, rewinds to the start and replays to the end', async () => {
        const v = await vm(kind, example('ifelse.s'));
        expect(runToEnd(v)).toBe('halted');
        expect(v.registers().regs[3]).toBe(7);
        expect(v.instructionCount).toBe(6);
        const end = v.registers();
        expect(v.runTo(0)).toBe('ok');
        expect(v.registers().regs.every((r, i) => r === (i === 14 ? 0x10000 : 0))).toBe(true);
        expect(v.stepBack()).toBe('at_start');
        expect(v.runTo(6)).toBe('ok');
        expect(Array.from(v.registers().regs)).toEqual(Array.from(end.regs));
      });

      it('runs the nested macro program and the call program', async () => {
        const n = await vm(kind, example('nested.s'));
        expect(runToEnd(n)).toBe('halted');
        const r = n.registers().regs;
        expect([r[2], r[5], r[6]]).toEqual([5, 1, 4]);
        const c = await vm(kind, example('call.s'));
        expect(runToEnd(c)).toBe('halted');
        expect(c.registers().regs[2]).toBe(6);
        expect(c.registers().regs[14]).toBe(0x10000);
      });

      it('reads data, draws into the framebuffer, and exposes memory and code', async () => {
        const v = await vm(kind, example('memory.s'));
        expect(runToEnd(v)).toBe('halted');
        expect(v.framebuffer().length).toBe(2048);
        expect(v.framebuffer()[6]).toBe(0xbeef);
        expect(v.framebuffer()[5]).toBe(0);
        expect(v.memory(0, 2)).toEqual(Uint32Array.of(0xdead, 0xbeef));
        expect(v.memory(0x25000, 3)).toEqual(new Uint32Array(3)); // unmapped reads as 0, like the mock
        expect(v.code(0, 1).length).toBe(1);
        expect(() => v.code(100000, 1)).toThrow(RangeError);
      });

      it('history: 48 bytes per step on the logging engine, none on the reversible one', async () => {
        const v = await vm(kind, example('loop.s'));
        runToEnd(v);
        expect(v.historyBytes).toBe(kind === 'logging' ? 48 * v.instructionCount : 0);
      });

      it('reports faults with a message and leaves state unchanged', async () => {
        const v = await vm(kind, 'start: xori r1, 0x25000\n xld r2, [r1+0]\n hlt\n'); // 0x25000 is unmapped
        expect(v.stepForward()).toBe('ok');
        const before = Array.from(v.registers().regs);
        expect(v.stepForward()).toBe('fault');
        expect(v.lastError).toMatch(/XLD/);
        expect(Array.from(v.registers().regs)).toEqual(before);
        expect(v.instructionCount).toBe(1);
      });

      it('direction -1 runs the program as its own inverse; host actions are accepted', async () => {
        const v = await vm(kind, example('loop.s'));
        runToEnd(v);
        const t = v.instructionCount;
        expect(v.setDirection(-1)).toBe('ok');
        expect(v.direction).toBe(-1);
        let s;
        while ((s = v.stepForward()) === 'ok') {}
        expect(s).toBe('halted');
        expect(v.instructionCount).toBe(2 * t);
        expect(v.registers().regs[3]).toBe(0);
        expect(v.pushInput(0x80)).toBe('ok');
        expect(v.setDirection(2 as never)).toBe('bad_arg');
      });
    });
  }
});

// ---- random scrubbing: the two engines must match after every action --------------------------------------------
function lcg(state: { s: number }): number {
  state.s = (Math.imul(state.s, 1664525) + 1013904223) >>> 0;
  return state.s >>> 8;
}

function randomSource(seed: number, len: number): string {
  const st = { s: seed };
  const reg = (): number => 1 + (lcg(st) % 8);
  const two = (): [number, number] => {
    const a = reg();
    let b = reg();
    while (b === a) b = reg();
    return [a, b];
  };
  const lines = ['start: xori r9, 0x100'];
  for (let i = 0; i < len; i++) {
    const imm = (lcg(st) % 200001) - 100000;
    switch (lcg(st) % 12) {
      case 0: { const [a, b] = two(); lines.push(` add r${a}, r${b}`); break; }
      case 1: { const [a, b] = two(); lines.push(` sub r${a}, r${b}`); break; }
      case 2: lines.push(` addi r${reg()}, ${imm}`); break;
      case 3: { const [a, b] = two(); lines.push(` xor r${a}, r${b}`); break; }
      case 4: lines.push(` xori r${reg()}, ${Math.abs(imm)}`); break;
      case 5: lines.push(` not r${reg()}`); break;
      case 6: { const [a, b] = two(); lines.push(` swap r${a}, r${b}`); break; }
      case 7: lines.push(` roli r${reg()}, ${lcg(st) % 32}`); break;
      case 8: lines.push(` xld r${reg()}, [r9+${lcg(st) % 0x200}]`); break;
      case 9: lines.push(` xst r${reg()}, [r9+${lcg(st) % 0x200}]`); break;
      case 10: {
        const [a, b] = two();
        let c = reg();
        while (c === a || c === b) c = reg();
        lines.push(` cswap r${c}, r${a}, r${b}`);
        break;
      }
      default: {
        const [a, b] = two();
        let c = reg();
        while (c === a || c === b) c = reg();
        lines.push(` toff r${a}, r${b}, r${c}`);
      }
    }
  }
  lines.push(' hlt');
  return lines.join('\n') + '\n';
}

const INPUT_SOURCE =
  'start: xori r1, 0x30000\n' +
  Array.from({ length: 40 }, () => ' xld r2, [r1+1]\n xld r3, [r1+0]\n xld r4, [r1+2]\n addi r5, 1\n').join('') +
  ' hlt\n';

function snapshot(v: WasmVm): string {
  const { regs, pc } = v.registers();
  return [Array.from(regs).join(','), pc, v.instructionCount, v.direction, Array.from(v.memory(0, 0x300)).join(','),
    Array.from(v.memory(0x10000, 16)).join(','), Array.from(v.framebuffer().subarray(0, 64)).join(',')].join('|');
}

describe('differential: logging vs reversible, in wasm', () => {
  const programs: [string, string][] = [
    ['ifelse', example('ifelse.s')],
    ['loop', example('loop.s')],
    ['call', example('call.s')],
    ['nested', example('nested.s')],
    ['input', INPUT_SOURCE],
    ...[1, 2, 3, 4, 5, 6].map((k): [string, string] => [`random${k}`, randomSource(k * 7919, 150)]),
  ];

  for (const [name, src] of programs) {
    it(`${name}: identical after every random action`, async () => {
      const a = await vm('logging', src);
      const b = await vm('reversible', src);
      const st = { s: 12345 + name.length };
      for (let k = 0; k < 500; k++) {
        const r = lcg(st) % 24;
        let sa: string, sb: string;
        if (r < 11) { sa = a.stepForward(); sb = b.stepForward(); }
        else if (r < 17) { sa = a.stepBack(); sb = b.stepBack(); }
        else if (r < 21) {
          const target = lcg(st) % (a.instructionCount + 40);
          sa = a.runTo(target); sb = b.runTo(target);
        } else if (r < 22) {
          const d = lcg(st) & 1 ? 1 : -1;
          sa = a.setDirection(d); sb = b.setDirection(d);
        } else {
          const val = lcg(st);
          sa = a.pushInput(val); sb = b.pushInput(val);
        }
        if (sa !== sb || snapshot(a) !== snapshot(b)) {
          throw new Error(`${name}: engines diverged at action ${k} (status ${sa} vs ${sb}, t=${a.instructionCount})`);
        }
      }
    });
  }

  it('rewinds a long run exactly with no history, and reports the speed', async () => {
    const src = example('loop.s').replace('addi r1, 4', 'addi r1, 50000');
    const a = await vm('logging', src);
    const b = await vm('reversible', src);
    const t0 = performance.now();
    expect(b.runTo(1e9)).toBe('halted');
    const fwd = performance.now() - t0;
    const steps = b.instructionCount;
    expect(steps).toBe(1 + 4 * 50000);
    expect(b.historyBytes).toBe(0);
    expect(a.runTo(steps)).toBe('ok');
    expect(a.historyBytes).toBe(48 * steps);
    expect(snapshot(a)).toBe(snapshot(b));
    const t1 = performance.now();
    expect(b.runTo(0)).toBe('ok');
    const back = performance.now() - t1;
    expect(b.registers().regs[3]).toBe(0);
    console.log(`wasm reversible: ${steps} steps forward in ${fwd.toFixed(1)} ms, back in ${back.toFixed(1)} ms, 0 bytes of history`);
  });
});
