// Assemble each example and run it on both C++ engines through rvm_run, checking results, then rewind and replay.
// Skipped (with a message) if rvm_run has not been built: `npm run build` at the repo root.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { assemble } from '../src/index.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const exe = process.platform === 'win32' ? 'rvm_run.exe' : 'rvm_run';
const candidates = [
  process.env.RVM_RUN,
  join(root, 'build', 'default', exe),
  join(root, 'build', 'default', 'Release', exe),
  join(root, 'build', 'debug', exe),
  join(root, 'build', 'debug', 'Debug', exe),
].filter((p): p is string => typeof p === 'string');
const rvmRun = candidates.find((p) => existsSync(p));
if (!rvmRun) console.warn('rvm_run not found; skipping integration tests. Build the repo root first.');

const dir = mkdtempSync(join(tmpdir(), 'rvmasm-'));
const example = (name: string): string => readFileSync(join(root, 'asm', 'examples', name), 'utf8');

interface Run {
  status: string;
  t: number;
  regs: number[];
  mem: Map<string, number>;
  historyBytes: number;
  rewind: string;
  replay: string;
}

function run(source: string, engine: 'logging' | 'reversible', mems: number[] = []): Run {
  const a = assemble(source);
  expect(a.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  const file = join(dir, `${engine}-${Math.abs(hash(source))}.rvm`);
  writeFileSync(file, a.image!);
  const args = [file, '--engine', engine, '--rewind'];
  for (const m of mems) args.push('--mem', '0x' + m.toString(16));
  const out = spawnSync(rvmRun!, args, { encoding: 'utf8' });
  expect(out.status).toBe(0);
  const text = out.stdout;
  const field = (re: RegExp): string => re.exec(text)?.[1] ?? '';
  const regs = Array.from({ length: 16 }, (_, r) => parseInt(field(new RegExp(`^r${r} 0x([0-9a-f]+)$`, 'm')), 16));
  const mem = new Map<string, number>();
  for (const m of text.matchAll(/^mem (0x[0-9a-f]+) 0x([0-9a-f]+)$/gm)) mem.set(m[1], parseInt(m[2], 16));
  return {
    status: field(/^status (\w+)$/m),
    t: parseInt(field(/^t (\d+)$/m), 10),
    regs,
    mem,
    historyBytes: parseInt(field(/^history_bytes (\d+)$/m), 10),
    rewind: field(/^rewind (\w+)$/m),
    replay: field(/^replay (\w+)$/m),
  };
}

function hash(s: string): number {
  let h = 0;
  for (let k = 0; k < s.length; k++) h = (h * 31 + s.charCodeAt(k)) | 0;
  return h;
}

describe.skipIf(!rvmRun).each(['logging', 'reversible'] as const)('assembled programs on the %s engine', (engine) => {
  it('ifelse.s takes the then branch', () => {
    const r = run(example('ifelse.s'), engine);
    expect(r.status).toBe('HALTED');
    expect(r.regs[3]).toBe(7);
    expect(r.t).toBe(6);
    expect([r.rewind, r.replay]).toEqual(['ok', 'ok']);
  });
  it('ifelse.s takes the else branch', () => {
    const r = run(example('ifelse.s').replace('addi r2, 5 ', 'addi r2, 9 '), engine);
    expect(r.regs[3]).toBe(100);
    expect(r.t).toBe(6);
    expect([r.rewind, r.replay]).toEqual(['ok', 'ok']);
  });
  it('loop.s computes 4 * 4', () => {
    const r = run(example('loop.s'), engine);
    expect([r.regs[1], r.regs[2], r.regs[3]]).toEqual([4, 4, 16]);
    expect([r.rewind, r.replay]).toEqual(['ok', 'ok']);
  });
  it('call.s calls twice and leaves the stack balanced', () => {
    const r = run(example('call.s'), engine, [0x10000, 0x10001]);
    expect(r.regs[2]).toBe(6);
    expect(r.regs[14]).toBe(0x10000);
    expect([r.mem.get('0x10000'), r.mem.get('0x10001')]).toEqual([0, 0]);
    expect([r.rewind, r.replay]).toEqual(['ok', 'ok']);
  });
  it('memory.s reads data, draws with xor, and negates', () => {
    const r = run(example('memory.s'), engine, [0x20005, 0x20006]);
    expect(r.regs[3]).toBe(0xdead);
    expect(r.regs[4]).toBe(0xffff4111);
    expect(r.mem.get('0x20005')).toBe(0); // drawn, then erased by xoring again
    expect(r.mem.get('0x20006')).toBe(0xbeef);
    expect([r.rewind, r.replay]).toEqual(['ok', 'ok']);
  });
  it('ifelse_macro.s and loop_macro.s behave like the hand-written versions', () => {
    const a = run(example('ifelse_macro.s'), engine);
    expect([a.regs[3], a.t, a.rewind, a.replay]).toEqual([7, 6, 'ok', 'ok']);
    const b = run(example('loop_macro.s'), engine);
    expect([b.regs[1], b.regs[2], b.regs[3], b.rewind, b.replay]).toEqual([4, 4, 16, 'ok', 'ok']);
  });
  it('nested.s: a loop with an if inside rewinds and replays exactly', () => {
    const r = run(example('nested.s'), engine);
    expect(r.status).toBe('HALTED');
    expect([r.regs[2], r.regs[5], r.regs[6]]).toEqual([5, 1, 4]);
    expect([r.rewind, r.replay]).toEqual(['ok', 'ok']);
  });
  it('bennett.s: .compute/.uncompute, .with and .plot leave every temporary at zero', () => {
    const r = run(example('bennett.s'), engine, [0x100, 0x20000 + 2 * 64 + 3, 0x20000 + 2 * 64 + 2]);
    expect(r.status).toBe('HALTED');
    expect([r.regs[1], r.regs[2], r.regs[3], r.regs[5], r.regs[6], r.regs[7]]).toEqual([5, 0, 3, 0, 2, 0]);
    expect(r.mem.get('0x100')).toBe(47); // (5 rotated left by 3) + 7
    expect(r.mem.get('0x20083')).toBe(0xffffff); // pixel (3, 2) of the screen
    expect(r.mem.get('0x20082')).toBe(0);
    expect([r.rewind, r.replay]).toEqual(['ok', 'ok']);
  });
  it('history is 48 bytes per step on the logging engine and none on the reversible one', () => {
    const r = run(example('loop.s'), engine);
    expect(r.historyBytes).toBe(engine === 'logging' ? 48 * r.t : 0);
  });
});
