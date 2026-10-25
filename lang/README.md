# lang/

The `rev` compiler: a Janus-family reversible language compiled to the machine's assembly, with a cost report.

- **The language reference** (statements, `fi`, loops, arrays, printing, the cost report, what it costs): [../docs/LANGUAGE.md](../docs/LANGUAGE.md).
- Example programs: [../examples/rev/](../examples/rev/) (`tour.rev` is the whole language in one short program) and
  [../examples/demos/pong.rev](../examples/demos/pong.rev).
- Source: `src/` (`parser.ts` -> `check.ts` -> `codegen.ts`, plus `invert.ts`, `report.ts`, `console.ts`). Tests: `test/`
  (`npm run test:lang`). `tools/gen_sort8.py` regenerates `examples/rev/sort8.rev`.
- Try it: `npm run rvmc -- examples/rev/fib.rev --report`.
