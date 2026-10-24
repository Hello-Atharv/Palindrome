// rvmc: the rev compiler. Usage:
//   rvmc prog.rev [-o prog.rvm] [--asm prog.s] [--map prog.rvm.map] [--report] [--json]
// Run from the repo root with:  npx vite-node lang/src/cli.ts -- prog.rev --report     (or `npm run rvmc -- prog.rev --report`)
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

import { compile, formatDiagnostics } from './compile.js';
import { analyze, formatReport } from './report.js';

const args = process.argv.slice(2).filter((a) => a !== '--');
const flag = (name: string): boolean => args.includes(name);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const valueOpts = new Set(['-o', '--asm', '--map', '--max-steps']);
const files = args.filter((a, i) => !a.startsWith('-') && !valueOpts.has(args[i - 1]));

if (files.length !== 1 || flag('--help')) {
  console.error('usage: rvmc prog.rev [-o prog.rvm] [--asm prog.s] [--map prog.rvm.map] [--report] [--json] [--max-steps n]');
  process.exit(files.length === 1 ? 0 : 2);
}

const file = files[0];
const source = readFileSync(file, 'utf8');
const result = compile(source);
if (!result.ok) {
  console.error(formatDiagnostics(basename(file), result.diagnostics));
  process.exit(1);
}
for (const w of result.warnings) console.error(`${basename(file)}:${w.line}: warning: ${w.message}`);
const out = opt('-o');
if (out) writeFileSync(out, result.image!);
const asmOut = opt('--asm');
if (asmOut) writeFileSync(asmOut, result.asm!);
const mapOut = opt('--map');
if (mapOut) writeFileSync(mapOut, JSON.stringify(result.assembled!.sourceMap));
if (!out && !asmOut && !flag('--report') && !flag('--json')) {
  console.log(`${file}: ok, ${result.assembled!.code.length} instructions (use -o to write the image, --report for the cost report)`);
}
if (flag('--report') || flag('--json')) {
  const report = await analyze(result, source, Number(opt('--max-steps') ?? 5_000_000));
  console.log(flag('--json') ? JSON.stringify(report, null, 2) : formatReport(report, basename(file)));
  if (report.fault || !report.roundTrip) process.exit(1);
}
