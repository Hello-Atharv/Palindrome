import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { INITIAL, Registry, parseRawGrammar, type IGrammar } from 'vscode-textmate';
import { createOnigScanner, createOnigString, loadWASM } from 'vscode-oniguruma';

import { cost, diagnose, lensText } from '../src/core.js';

const here = (p: string): string => new URL(`../${p}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const repo = (p: string): string => here(`../${p}`);

// ---- the grammars, run through the same engine VS Code uses ----
let ready: Promise<void> | undefined;
async function grammar(scopeName: string, file: string): Promise<IGrammar> {
  ready ??= loadWASM(readFileSync(here('node_modules/vscode-oniguruma/release/onig.wasm')).buffer as ArrayBuffer);
  await ready;
  const registry = new Registry({
    onigLib: Promise.resolve({ createOnigScanner, createOnigString }),
    loadGrammar: async () => parseRawGrammar(readFileSync(here(file), 'utf8'), file),
  });
  const g = await registry.loadGrammar(scopeName);
  if (!g) throw new Error('grammar did not load');
  return g;
}

/** token text -> the most specific scope, for one line */
function tokens(g: IGrammar, line: string): Map<string, string> {
  const out = new Map<string, string>();
  const r = g.tokenizeLine(line, INITIAL);
  for (const t of r.tokens) out.set(line.slice(t.startIndex, t.endIndex), t.scopes[t.scopes.length - 1]);
  return out;
}

describe('rev grammar', () => {
  it('colours keywords, numbers, operators, comments and procedure names', async () => {
    const g = await grammar('source.rev', 'syntaxes/rev.tmLanguage.json');
    expect(tokens(g, 'proc step { a += b; }').get('proc')).toMatch(/storage\.type\.function/);
    expect(tokens(g, 'proc step { a += b; }').get('step')).toMatch(/entity\.name\.function/);
    expect(tokens(g, 'proc step { a += b; }').get('+=')).toMatch(/assignment\.reversible/);
    expect(tokens(g, 'a <=> b;').get('<=>')).toMatch(/swap/);
    const ifLine = tokens(g, 'if (a > b) { skip; } else { skip; } fi (f != 0);');
    expect(ifLine.get('if')).toMatch(/keyword\.control/);
    expect(ifLine.get('fi')).toMatch(/keyword\.control/);
    expect(ifLine.get('>')).toMatch(/comparison/);
    expect(ifLine.get('skip')).toMatch(/keyword\.other/);
    expect(tokens(g, 'var x = 0xFF, y = 0b101, z = 12;').get('0xFF')).toMatch(/hex/);
    expect(tokens(g, 'var x = 0xFF, y = 0b101, z = 12;').get('12')).toMatch(/decimal/);
    expect(tokens(g, 'x ^= latest + events;').get('latest')).toMatch(/input/);
    expect(tokens(g, 'var s @ mem = 3;').get('mem')).toMatch(/modifier/);
    expect(tokens(g, '// a comment with if and var in it').get('// a comment with if and var in it')).toMatch(/comment/);
    expect(tokens(g, 'call step;').get('step')).toMatch(/entity\.name\.function/);
    expect(tokens(g, 'call step;').get('call')).toMatch(/keyword\.control\.flow/);
    expect(tokens(g, 'uncall step;').get('uncall')).toMatch(/keyword\.control\.flow/);
  });

  it('tokenises every shipped rev program without leaving a keyword uncoloured', async () => {
    const g = await grammar('source.rev', 'syntaxes/rev.tmLanguage.json');
    for (const f of ['lang/examples/fib.rev', 'lang/examples/sort3.rev', 'programs/pong.rev']) {
      let stack = INITIAL;
      for (const line of readFileSync(repo(f), 'utf8').split('\n')) {
        const r = g.tokenizeLine(line, stack);
        stack = r.ruleStack;
        for (const t of r.tokens) {
          const text = line.slice(t.startIndex, t.endIndex);
          if (/^(if|else|fi|from|until|call|uncall|proc|main|var|out)$/.test(text) && !t.scopes.some((s) => s.includes('comment'))) {
            expect(t.scopes[t.scopes.length - 1], `${f}: '${text}'`).not.toBe('source.rev');
          }
        }
      }
    }
  });
});

describe('assembly grammar', () => {
  it('colours instructions, registers, labels, macros, directives and comments', async () => {
    const g = await grammar('source.rvm-asm', 'syntaxes/rvm-asm.tmLanguage.json');
    const l = tokens(g, 'start:  addi r1, 0x20000        ; comment');
    expect(l.get('start')).toMatch(/label/);
    expect(l.get('addi')).toMatch(/instruction/);
    expect(l.get('r1')).toMatch(/register/);
    expect(l.get('0x20000')).toMatch(/hex/);
    expect(l.get('; comment')).toMatch(/comment/);
    expect(tokens(g, '        .if  eq, r1, r2').get('.if')).toMatch(/macro/);
    expect(tokens(g, '        .equ FB, 3').get('.equ')).toMatch(/directive/);
    expect(tokens(g, '        br   eq, r1, r2, Lthen').get('br')).toMatch(/control/);
    expect(tokens(g, '        toff r1, r2, r3').get('toff')).toMatch(/gate/);
  });
});

// ---- the logic behind the editor features ----
describe('editor logic', () => {
  it('diagnoses rev and assembly source', () => {
    expect(diagnose('rev', 'var x; main { x += x; }')[0]).toMatchObject({ line: 1, severity: 'error' });
    expect(diagnose('rev', 'var x; main { x += 1; }')).toEqual([]);
    expect(diagnose('rvm-asm', 'start: add r1, r1\n hlt\n')[0].message).toMatch(/r1|differ|same/i);
    expect(diagnose('rvm-asm', 'start: addi r1, 1\n hlt\n')).toEqual([]);
  });

  it('reports suspicious fi clauses as warnings, not errors', () => {
    const ds = diagnose('rev', 'var a = 5, b = 3, f = 0; main { if (a > b) { a <=> b; f += 1; } fi (a > b); }');
    expect(ds.length).toBe(1);
    expect(ds[0]).toMatchObject({ line: 1, severity: 'warning' });
    expect(ds[0].message).toMatch(/repeats the test/);
    expect(diagnose('rev', 'var a = 5, b = 3, f = 0; main { if (a > b) { a <=> b; f += 1; } fi (f != 0); }')).toEqual([]);
  });

  it('computes per-line costs, a summary, and the report', async () => {
    const src = readFileSync(repo('lang/examples/fib.rev'), 'utf8');
    const c = await cost(src);
    expect(c.ok).toBe(true);
    expect(c.lines.length).toBeGreaterThan(3);
    expect(c.lines.reduce((s, l) => s + l.steps, 0)).toBe(95);
    expect(c.summary).toMatch(/95 steps.*0 B history.*garbage.*undo verified/);
    expect(c.report).toMatch(/cost by source line/);
    expect(lensText({ line: 1, steps: 1234, percent: 12.34, instructions: 3 })).toBe('1,234 steps, 12.3%');
    expect(lensText({ line: 1, steps: 1, percent: 0.01, instructions: 1 })).toBe('1 steps, <0.1%');
  });

  it('turns a compile error into a diagnostic and no costs', async () => {
    const c = await cost('var x; main { x = 1; }');
    expect(c.ok).toBe(false);
    expect(c.lines).toEqual([]);
    expect(c.diagnostics[0].message).toMatch(/destroy/);
  });

  it('reports an assertion the program breaks as a diagnostic', async () => {
    const c = await cost('var a = 1, f = 0; out a; main { if (a == 1) { skip; } else { skip; } fi (f != 0); }');
    expect(c.ok).toBe(false);
    expect(c.diagnostics[0].message).toMatch(/assertion/i);
  });
});

describe('extension manifest', () => {
  it('declares the languages, grammars and commands it needs', () => {
    const pkg = JSON.parse(readFileSync(here('package.json'), 'utf8'));
    expect(pkg.contributes.languages.map((l: { id: string }) => l.id)).toEqual(['rev', 'rvm-asm']);
    for (const g of pkg.contributes.grammars) expect(() => JSON.parse(readFileSync(here(g.path), 'utf8'))).not.toThrow();
    for (const l of pkg.contributes.languages) expect(() => JSON.parse(readFileSync(here(l.configuration), 'utf8'))).not.toThrow();
    expect(pkg.contributes.commands.map((c: { command: string }) => c.command)).toEqual(['rev.showReport', 'rev.debug']);
    expect(pkg.main).toBe('./dist/extension.js');
  });
});
