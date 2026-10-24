#!/usr/bin/env node
// Command line: rvmasm input.s [-o out.rvm] [--map out.rvm.map] [--list]
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

import { assemble } from './assemble.js';
import { formatDiagnostic } from './diag.js';

function usage(): never {
  process.stderr.write('usage: rvmasm input.s [-o out.rvm] [--map out.rvm.map] [--list]\n');
  process.exit(2);
}

const args = process.argv.slice(2);
let input: string | null = null;
let out: string | null = null;
let mapPath: string | null = null;
let list = false;
for (let k = 0; k < args.length; k++) {
  const a = args[k];
  if (a === '-o') out = args[++k] ?? usage();
  else if (a === '--map') mapPath = args[++k] ?? usage();
  else if (a === '--list') list = true;
  else if (a.startsWith('-')) usage();
  else if (input === null) input = a;
  else usage();
}
if (input === null) usage();

const result = assemble(readFileSync(input, 'utf8'), { fileName: basename(input) });
for (const d of result.diagnostics) process.stderr.write(formatDiagnostic(input, d) + '\n');

if (list) {
  for (const r of result.listing) {
    const addr = r.addr.toString(16).padStart(4, '0');
    const word = r.word.toString(16).padStart(8, '0');
    process.stdout.write(`${addr}  ${word}  ${String(r.line).padStart(4)}  ${r.text}\n`);
  }
}
if (!result.ok || !result.image) process.exit(1);

writeFileSync(out ?? input.replace(/\.[^./\\]*$/, '') + '.rvm', result.image);
if (mapPath !== null) writeFileSync(mapPath, JSON.stringify(result.sourceMap));
