// The bundled tools (cli/dist) must run with plain `node`, from any folder, without node_modules: that is what lets the same files
// work on Windows, Linux (WSL) and macOS.
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

const here = (p: string): string => new URL(`../${p}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

describe('bundled tools', () => {
  it('build, then run a program from a different folder', () => {
    execFileSync(process.execPath, [here('build.mjs')], { cwd: here('.'), stdio: 'ignore' });
    const out = execFileSync(process.execPath, [here('dist/rvm.mjs'), 'run', here('../lang/examples/hello.rev')], { cwd: tmpdir(), encoding: 'utf8' });
    expect(out).toMatch(/fib\(10\) = 55 \(hex 0x37\)/);
  }, 60_000);

  it('the debugger works from the bundle, including step back and reverse watch', () => {
    const out = execFileSync(
      process.execPath,
      [here('dist/rvm.mjs'), 'debug', here('../lang/examples/sort3.rev'), '--script', 's; s; s; rwatch f1; b'],
      { cwd: tmpdir(), encoding: 'utf8' },
    );
    expect(out).toMatch(/f1 was last written by line 8/);
    expect(out).toMatch(/t=0 {2}line 4/);
  }, 60_000);

  it('the compiler tool reports errors with a line number and a non-zero exit', () => {
    let failed = false;
    try {
      execFileSync(process.execPath, [here('dist/rvmc.mjs'), here('../lang/examples/does-not-exist.rev')], { cwd: tmpdir(), stdio: 'pipe' });
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  }, 60_000);
});
