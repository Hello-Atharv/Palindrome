# How the pieces fit together

One idea shapes the repo: **the logic lives in a few shared cores, and everything a person touches (terminal, editor, browser) is a thin
front end over them.** Nothing is implemented twice.

## 1. What happens to a program
```
  you write        a program in rev
      |
      |   lang/    the rev compiler (TypeScript)
      |            checks the reversibility rules, builds each expression and
      |            un-builds it, and writes the per-line cost report
      v
  assembly         text, one instruction per line
      |            (or you write this directly)
      |   asm/     the assembler (TypeScript)
      |            expands macros (.if, .loop, .print), packs 32-bit words
      v
  a program        the .rvm file: the instruction words, the starting data,
      |            and a source map for the debugger
      |   vm/      the machine (C++, also compiled to WebAssembly)
      |            two engines for one instruction set:
      |              logging    keeps a diary of every change (the oracle)
      |              reversible keeps nothing; steps back by computing inverses
      v
  a running        registers, memory, the screen. You step it forward AND back.
  machine
```
The contract that all of these agree on is `spec/` (the instructions, the memory map, the console, the cost model, the file formats).

## 2. Who drives the machine
```
        Terminal               VS Code                 Browser
        cli/                   vscode/                 web/viz
        (rvm, rvmc)            (colours, errors,       (play, scrub, compare,
                                cost beside a line)     edit rev, benchmarks)
            \                     |                      /
             \                    |                     /
              v                   v                    v
        ------------------------------------------------------------
         shared code (no terminal, no browser, no editor inside it):
           compiler     lang/
           assembler    asm/
           debugger     cli/src/debugger.ts
           verifier     cli/src/verify.ts
           engines      vm/ (C++), used in the browser as web/wasm/
        ------------------------------------------------------------
```
The same compiler gives the terminal its errors, VS Code its squiggles and the browser its live editor. The same engines, compiled
once to WebAssembly, run in all three.

## 3. Where things live
| Folder | What | Language |
|---|---|---|
| `spec/` | the contract (instructions, memory map, console, cost model, file formats) and `CHANGELOG.md` | text, TS and C headers |
| `vm/` | the two engines and their C++ tests; `vm/wasm/` builds them for the browser | C++17 |
| `web/wasm/` | `createWasmVm()`: the engines behind one interface, and the shared `FrameTracker` | TypeScript |
| `asm/` | the assembler and its macros | TypeScript |
| `lang/` | the `rev` compiler and the cost report | TypeScript |
| `cli/` | `rvm` and `rvmc`, the debugger (`debugger.ts`) and the verifier (`verify.ts`) | TypeScript |
| `vscode/` | the editor extension | TypeScript |
| `web/viz/`, `web/mock_vm/` | the browser UI, and a stand-in VM it can use without the real engines | TypeScript |
| `bench/` | speed of the engines; `bench/twins/` = conventional twins and the fair baselines | TypeScript, C++ |
| `examples/` | every runnable program: `asm/` (teaching), `rev/` (the language), `demos/` (cipher, sort, Pong) | rev, assembly |
| `docs/` | the guides, the demo script, the writeup, hackathon material, `status/` (who did what) | Markdown |

## Rules that keep it from getting messy
1. **A front end never contains logic.** The terminal debugger and any future VS Code debug panel call `cli/src/debugger.ts`. The browser
   UI, the extension and `rvmc` all call `lang/src/compile.ts` and `report.ts`.
2. **Everything shared is browser-safe TypeScript** (no Node imports in `asm/`, `lang/src/compile.ts`, `report.ts`, `console.ts`,
   `debugger.ts`), so the same code runs in Node, in the browser and inside the VS Code extension.
3. **The contract is `spec/`.** Change it only through `core`, with a line in `spec/CHANGELOG.md`.
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
- **The browser debugger is smaller than the terminal one.** The browser UI steps, scrubs, has breakpoints in the code listing and steps by
  frame, but "who last wrote this variable?" (`rwatch`) and source-line stepping are terminal-only for now (`cli/src/debugger.ts`).
- **Documentation numbers** (README, writeup) are copied from `bench/results.json` by hand; regenerate and re-check them after any
  benchmark change.
