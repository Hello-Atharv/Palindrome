# CLAUDE.md

## Project
OxHack 2026 (theme: TIME). A **reversible computer**: a small ISA in which every instruction is a
bijection on machine state, so any program runs backwards with no history log.
(Reversible computing is old: Bennett, Janus, Pendulum. Our contribution is a complete, verified,
interactive stack plus honest measurements. Never claim to have invented the idea.)

Two engines behind one API: a **logging VM** (records deltas; the correctness oracle and benchmark
baseline) and a **reversible VM** (no log). Both must agree on state at every instruction count.
Deliverables: both VMs, assembler with macros, demo programs (Pong, a reversible cipher, a sort that
exposes its garbage), web UI (visualiser + debugger with step back), benchmarks, a funny but truthful
writeup. Judges: quant engineers and a rigour-loving head judge; sponsors in `docs/hackathon/sponsors_notes.txt`.

## Rules (read first)
1. **Before any task, read `spec/SPEC.md` and every file in `docs/status/`.**
2. **Any change to `spec/` must add a line to `spec/CHANGELOG.md` and be flagged to the user.** Only `core` edits `spec/`; others request changes through their status file or the user.
3. **Update your own `docs/status/` file when you finish a task; never edit someone else's.**
4. Stay in your own directory. Need something elsewhere? Say so in your status file.
5. Code against the contract: web uses `spec/vm_api.ts`, C++ uses `spec/vm_api.h`, programs follow `spec/asm_syntax.md`.
6. LF line endings; 4 spaces for C++, 2 for web (`.editorconfig`).

## Repo map and owners (one owner per directory)
| Dir | Purpose | Owner |
|---|---|---|
| spec/ | ISA spec, TS + C APIs, file formats, `CHANGELOG.md` | core |
| vm/ | logging VM + reversible VM (C++17 lib `rvm`), their CTest tests in `vm/tests/`, the WebAssembly build | core |
| asm/ | assembler + macros | core |
| lang/ | `rev` language compiler (to asm), cost report | core |
| cli/ | `rvm` command: build, run, report, verify, debug (step back); the shared debugger logic is `cli/src/debugger.ts` | core |
| vscode/ | VS Code extension: grammars, diagnostics, per-line cost | core |
| bench/ | benchmarks and the fair baselines (`bench/twins`) | core |
| examples/ | every runnable program: `asm/` (small teaching programs), `rev/` (the language: `tour.rev` and its debugger script), `demos/` (cipher, sort, Pong) | core / games |
| docs/ | all the written material: guides, architecture, demo script, writeup, hackathon material, and `status/` (one `<name>.md` per person, that person only) | core |
| web/wasm/ | the engines in the browser (WebAssembly) and the shared `FrameTracker` | core |
| web/viz/ and web/mock_vm/ | visualiser: CPU, memory, framebuffer, app shell; mock VM | viz |

## Role quick-starts
- **viz**: build the app shell in `web/viz/`, importing types from `spec/vm_api.ts`. First build `web/mock_vm`
  (a small JS/TS interpreter of SPEC section 6, implementing `RVM`) so everyone can work before the real VM lands. Show registers, PC, disassembly (`code()` + `Op`), memory, 64x32 framebuffer. Export a shell the debugger can mount into.
- **debugger**: the debugger logic is `cli/src/debugger.ts` (headless, shared by the terminal, VS Code and any UI); a browser panel would call it and live in `web/viz` (read SPEC section 11): timeline scrubber (`runTo`), "step by frame" (FRAME word at `0xFFFF`, SPEC 11.7), step/back buttons, run/pause, breakpoints on PC, direction toggle (`setDirection`), history-memory readout (`historyBytes`), highlight what changed between steps by diffing snapshots. Develop against `web/mock_vm`.
- **games**: `examples/demos/`: key codes and the FRAME counter are in SPEC 11.7. Write Pong first (see `examples/demos/README.md` for reversible idioms), in the syntax of `spec/asm_syntax.md`. Until the assembler exists, write a plain-JS model of the game (state, input, frame) and the exact register/memory layout, then translate. Cipher and sort are the fallback demos.
- **core**: logging VM -> minimal assembler (TypeScript, Node + browser) -> `if`/`loop` macros -> WASM build -> reversible VM, differential-tested against the oracle -> benchmarks.

## Build and test (C++)
Needs CMake >= 3.21, a C++17 compiler (MSVC or Apple clang), Node.
- `npm run build` configure + build (Release) / `npm test` build + CTest / `npm run dev` Debug build.
Underlying: `cmake --preset default`, `cmake --build --preset default`, `ctest --preset default`.

## Real VM in the browser
`web/wasm/` is the C++ VMs compiled to WebAssembly behind the `RVM` interface: `await createWasmVm('reversible')` (or
`'logging'`) is a drop-in for `web/mock_vm`. Prebuilt and committed; see `web/wasm/README.md`.

## Assembler
`cd asm && npm install && npm run build`, then `node asm/dist/cli.js prog.s -o prog.rvm`. Run a program with
`build/default/rvm_run prog.rvm --engine reversible --rewind` (built by `npm run build` at the root). Syntax: `spec/asm_syntax.md`.

## Merge hygiene (so the final merge is boring)
- **Short branches.** Branch from the latest `scaffold`; before every push run `git fetch && git merge origin/scaffold`, then `npm run check`
  (typecheck + all tests, including `web/viz` and `web/mock_vm`). Push at least every few hours; no long-lived branches.
- **Disjoint files.** The UI owner edits existing files in `web/viz` for layout, style and polish. Core never rewrites those files: core's
  logic lives in shared code (`lang/`, `asm/`, `web/wasm/`, `cli/`), and `web/viz` only calls it through one thin glue file. When core
  must touch an existing `web/viz` file, it is one small commit announced in `docs/status/core.md` first, and the UI owner leaves that file alone until it is merged.
- **Shared files** (root `package.json`, `CLAUDE.md`, `spec/`, `docs/`): edit in a commit of their own, say so in your status file.
- **Never force-push** a shared branch. If a push is refused, push to a new branch name and tell the other person.
- A spec or input-format change updates `spec/CHANGELOG.md`, the engines, the mock VM and the docs together, in one commit or one announced set.

## Git workflow
Branch from `scaffold` (later `main`): `git checkout -b <role>/<topic>`. Commit small, rebase often. Directories have one owner, so merges should not conflict; if one does, ask. Do not rewrite shared branches. `build/` and `node_modules/` are ignored.
