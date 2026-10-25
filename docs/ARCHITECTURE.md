# How the pieces fit together

One idea shapes the repo: **the logic lives in a few shared cores; everything a person touches is a thin front end over them.**
Nothing is implemented twice.

```
                         spec/        the contract: instructions, memory map, console, cost model, file formats
                           |
   vm/  C++ engines (logging + reversible)  ──compiled to WebAssembly──►  web/wasm/src   createWasmVm(): the RVM interface
                           |
   asm/   the assembler (TypeScript)         lang/   the rev compiler, cost report, console reader (TypeScript)
   cli/src/debugger.ts   step back, breakpoints, reverse watch (headless)     cli/src/verify.ts   engines agree, exact undo
          \________________________  shared cores: no terminal, no browser, no editor  ________________________/
                           |
   front ends (thin):
     cli/            the `rvm` and `rvmc` commands (terminal)
     vscode/         the editor extension: colours, errors, cost beside each line
     web/wasm/playground   the engines in a browser: play, scrub, compare, edit rev live (our development harness)
     web/viz         Atharv's UI (on its own branch until merged)
   measurements:
     bench/          speed of the engines; bench/twins = conventional twins and fair baselines (TWINS.md, results.json)
   content:
     programs/       the demo programs;  demo/ the demo script and writeup;  docs/ the guides;  status/ who did what
```

## Rules that keep it from getting messy
1. **A front end never contains logic.** The terminal debugger, the (future) browser debugger and the (future) VS Code debug panel
   all call `cli/src/debugger.ts`. The playground, the extension and `rvmc` all call `lang/src/compile.ts` and `report.ts`.
2. **Everything shared is browser-safe TypeScript** (no Node imports in `asm/`, `lang/src/compile.ts`, `report.ts`, `console.ts`,
   `debugger.ts`), so the same code runs in Node, in the browser and inside the VS Code extension.
3. **The contract is `spec/`.** Change it only through `core`, with a line in `SPEC_CHANGELOG.md`.
4. **Generated files are marked.** `bench/TWINS.md` and `bench/results.json` come from `npm run bench:twins`; `dist/` folders are never
   committed and are rebuilt by `npm run setup`.
5. **Docs have one home.** Concepts: `docs/GUIDE.md`. Each package has a short README for its own commands. Numbers live in
   `bench/TWINS.md`; other documents quote them and say where they came from.

## Running it on different operating systems
- The tools are built into single files (`cli/dist/rvm.mjs`, `rvmc.mjs`, `vscode/dist/extension.js`) that run with plain `node` and
  need no `node_modules`, so one build works on Windows, Linux (WSL) and macOS.
- The engines are committed as WebAssembly (`web/wasm/lib/rvm_core.js`), so nothing needs a C++ compiler except engine development
  and the C++ tests.
- `node_modules` hold native programs per operating system. If you share one checkout between Windows and WSL, do not run the
  JavaScript tests from both; run them from one, or `npm run setup` separately in each checkout.

## Known loose ends (honest list)
- **Two UIs:** the playground and Atharv's `web/viz`. After merging, `web/viz` becomes the product and the playground is kept as a small
  development harness (or folded in).
- **`web/debugger/`** holds only a README: the debugger's logic lives in `cli/src/debugger.ts` so every front end can share it. The
  browser debugger panel, when built, belongs there.
- **Documentation numbers** (README, writeup) are copied from `bench/results.json` by hand; regenerate and re-check them after any
  benchmark change.
