// The bundled tools (cli/dist) must run with plain `node`, from any folder, without node_modules: that is what lets the same files
// work on Windows, Linux (WSL) and macOS.
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

const here = (p: string): string => new URL(`../${p}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

describe('bundled tools', () => {
  it('build, then run a program from a different folder', () => {
    execFileSync(process.execPath, [here('build.mjs')], { cwd: here('.'), stdio: 'ignore' });
    const out = execFileSync(process.execPath, [here('dist/rvm.mjs'), 'run', here('../examples/rev/hello.rev')], { cwd: tmpdir(), encoding: 'utf8' });
    expect(out).toMatch(/This is line 3 of 3\./);
  }, 60_000);

  it('the debugger works from the bundle, including step back and reverse watch', () => {
    const out = execFileSync(
      process.execPath,
      [here('dist/rvm.mjs'), 'debug', here('../examples/rev/sort3.rev'), '--script', 's; s; s; rwatch f1; b'],
      { cwd: tmpdir(), encoding: 'utf8' },
    );
    expect(out).toMatch(/f1 was last written by line 8/);
    expect(out).toMatch(/t=0 {2}line 4/);
  }, 60_000);

  it('the narrated tour runs straight through (piped, so no pauses) and shows the key moments', () => {
    const out = execFileSync(
      process.execPath,
      [here('dist/rvm.mjs'), 'debug', here('../examples/rev/tour.rev'), '--demo', here('../examples/rev/tour.dbg')],
      { cwd: tmpdir(), encoding: 'utf8' },
    );
    expect(out).not.toMatch(/unknown command|don't know what|needs a/);
    expect(out).toMatch(/f was last written by line 15/);
    expect(out).toMatch(/0 -> 1/);
    expect(out).toMatch(/0 bytes of history/);
    expect(out).toMatch(/big\ntotal = 36/); // the console after running to the end
    expect(out).toMatch(/\(nothing printed yet\)/); // and un-printed again after stepping back
  }, 60_000);

  it('the compiler tool reports errors with a line number and a non-zero exit', () => {
    let failed = false;
    try {
      execFileSync(process.execPath, [here('dist/rvmc.mjs'), here('../examples/rev/does-not-exist.rev')], { cwd: tmpdir(), stdio: 'pipe' });
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  }, 60_000);
});
