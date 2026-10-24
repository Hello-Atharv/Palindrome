// Where each variable lives. Scalars take registers r1..r9 in declaration order; any further scalars, and all arrays, live in
// data memory (word addresses, SPEC section 5). `var a[n] @ 0x20000` places an array at an absolute address, which is how the
// program reaches the framebuffer (0x20000) or the input window (0x30000).

import type { Diagnostic, Program } from './ast.js';

export const MAX_REG_VARS = 9;
export const FRAME_WORD = 0xffff; // reserved by SPEC 11.7
export const CONSOLE_START = 0xe000; // SPEC 11.9: 0xE000..0xFFFE is the console (buffer and length)
const DATA_END = 0x10000;

export type VarInfo =
  | { kind: 'reg'; reg: number; size: 0; init: number[] }
  | { kind: 'mem'; addr: number; size: number; isArray: boolean; init: number[] };

export interface Layout {
  vars: Map<string, VarInfo>;
  /** (address, words) of the initial data image, ascending, gaps are zero */
  data: { addr: number; words: number[] }[];
  diagnostics: Diagnostic[];
}

const mapped = (a: number, n: number): boolean =>
  (a + n <= DATA_END) || (a >= 0x20000 && a + n <= 0x20800) || (a >= 0x30000 && a + n <= 0x40000);

export function layout(prog: Program): Layout {
  const vars = new Map<string, VarInfo>();
  const diagnostics: Diagnostic[] = [];
  const err = (line: number, message: string): void => { diagnostics.push({ line, message }); };

  let regs = 0;
  const placed: { name: string; addr: number; size: number; init: number[]; line: number }[] = [];
  const floating: { name: string; size: number; isArray: boolean; init: number[]; line: number }[] = [];

  for (const v of prog.vars) {
    if (vars.has(v.name)) continue; // duplicates are reported by check()
    if (v.size === 0 && v.addr === undefined && !v.inMemory && regs < MAX_REG_VARS) {
      vars.set(v.name, { kind: 'reg', reg: ++regs, size: 0, init: v.init });
    } else if (v.addr !== undefined) {
      const n = Math.max(1, v.size);
      if (!mapped(v.addr, n)) err(v.line, `${v.name} @ 0x${v.addr.toString(16)} (${n} words) is not in mapped memory`);
      if (v.addr >= DATA_END && v.init.some((x) => x !== 0)) err(v.line, `${v.name} is placed outside the data region, so it cannot have initial values`);
      if (v.addr <= FRAME_WORD && v.addr + n > FRAME_WORD && !(v.addr === FRAME_WORD && n === 1)) {
        err(v.line, `${v.name} overlaps data word 0xFFFF, which is the FRAME counter (declare it alone: var frame @ 0xFFFF)`);
      }
      vars.set(v.name, { kind: 'mem', addr: v.addr, size: n, isArray: v.size > 0, init: v.init });
      placed.push({ name: v.name, addr: v.addr, size: n, init: v.init, line: v.line });
    } else {
      floating.push({ name: v.name, size: Math.max(1, v.size), isArray: v.size > 0, init: v.init, line: v.line });
    }
  }

  // free-floating memory variables go in the lowest data addresses that do not collide with an absolute placement
  const taken = placed.filter((p) => p.addr < DATA_END).sort((a, b) => a.addr - b.addr);
  let cursor = 0;
  const bump = (size: number): number => {
    for (;;) {
      const clash = taken.find((p) => cursor < p.addr + p.size && p.addr < cursor + size);
      if (!clash) return cursor;
      cursor = clash.addr + clash.size;
    }
  };
  for (const f of floating) {
    const addr = bump(f.size);
    if (addr + f.size > CONSOLE_START) {
      err(f.line, `no room in the data region for ${f.name} (${f.size} words)`);
      continue;
    }
    cursor = addr + f.size;
    vars.set(f.name, { kind: 'mem', addr, size: f.size, isArray: f.isArray, init: f.init });
    placed.push({ name: f.name, addr, size: f.size, init: f.init, line: f.line });
    taken.push({ name: f.name, addr, size: f.size, init: f.init, line: f.line });
  }

  const data = placed
    .filter((p) => p.addr < DATA_END && p.init.some((x) => x !== 0))
    .sort((a, b) => a.addr - b.addr)
    .map((p) => ({ addr: p.addr, words: p.init.slice() }));
  return { vars, data, diagnostics };
}
