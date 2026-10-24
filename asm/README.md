# asm/
Purpose: the assembler. TypeScript; runs as a Node command line tool and in the browser (Code view).
`.s` assembly (`spec/asm_syntax.md`) becomes a `.rvm` image (`spec/program_format.md`) plus a listing and source map.
It rejects non-reversible operands and checks the BR/LND and CALL/PROC/RET pairing rules, with source lines.
Owner: **core**.

```
cd asm && npm install && npm run build
node dist/cli.js examples/ifelse.s -o /tmp/x.rvm --list
npm test            # unit tests + integration tests (needs rvm_run: run `npm run build` at the repo root first)
```
- `src/assemble.ts` two-pass assembler, `src/checks.ts` control-flow rules, `src/image.ts` .rvm writer,
  `src/expr.ts` constant expressions, `src/parser.ts` lines, `src/cli.ts` command line (Node only).
- `examples/` runnable programs from the spec; the integration tests run them on both engines and rewind them.
`src/macros.ts`: `.if/.else/.fi` and `.loop/.again` expand to br/lnd before assembly (see `spec/asm_syntax.md`).
Later: `compute/copy/uncompute` macros.
