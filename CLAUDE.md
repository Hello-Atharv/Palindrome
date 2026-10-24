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
writeup. Judges: quant engineers and a rigour-loving head judge; sponsors in `sponsors_notes.txt`.

## Rules (read first)
1. **Before any task, read `spec/SPEC.md`, `DECISIONS.md` and every file in `status/`.** (`DECISIONS.md` separates settled decisions from proposals.)
2. **Any change to `spec/` must add a line to `SPEC_CHANGELOG.md` and be flagged to the user.** Only `core` edits `spec/`; others request changes through their status file or the user.
3. **Update your own `status/` file when you finish a task; never edit someone else's.**
4. Stay in your own directory. Need something elsewhere? Say so in your status file.
5. Code against the contract: web uses `spec/vm_api.ts`, C++ uses `spec/vm_api.h`, programs follow `spec/asm_syntax.md`.
6. LF line endings; 4 spaces for C++, 2 for web (`.editorconfig`).

## Repo map and owners (one owner per directory)
| Dir | Purpose | Owner |
|---|---|---|
| spec/ | ISA spec, TS + C APIs, file formats | core |
| vm/, tests/ | logging VM + reversible VM (C++17 lib `rvm`), CTest tests | core |
| asm/ | assembler + macros | core |
| bench/, demo/ | benchmarks, demo script, writeup | core |
| web/viz/ and web/mock_vm/ | visualiser: CPU, memory, framebuffer, app shell; mock VM | viz |
| web/debugger/ | debugger: scrubber timeline, step back, breakpoints | debugger |
| programs/ | demo programs in assembly (Pong first) | games |
| status/ | one `<name>.md` per person | that person only |

## Role quick-starts
- **viz**: build the app shell in `web/viz/`, importing types from `spec/vm_api.ts`. First build `web/mock_vm`
  (a small JS/TS interpreter of SPEC section 6, implementing `RVM`) so everyone can work before the real VM lands. Show registers, PC, disassembly (`code()` + `Op`), memory, 64x32 framebuffer. Export a shell the debugger can mount into.
- **debugger**: `web/debugger/`: timeline scrubber (`runTo`), step/back buttons, run/pause, breakpoints on PC, direction toggle (`setDirection`), history-memory readout (`historyBytes`), highlight what changed between steps by diffing snapshots. Develop against `web/mock_vm`.
- **games**: `programs/`: write Pong first (see `programs/README.md` for reversible idioms), in the syntax of `spec/asm_syntax.md`. Until the assembler exists, write a plain-JS model of the game (state, input, frame) and the exact register/memory layout, then translate. Cipher and sort are the fallback demos.
- **core**: logging VM -> minimal assembler -> `if`/`loop` macros -> WASM build -> reversible VM, differential-tested against the oracle -> benchmarks.

## Build and test (C++)
Needs CMake >= 3.21, a C++17 compiler (MSVC or Apple clang), Node.
- `npm run build` configure + build (Release) / `npm test` build + CTest / `npm run dev` Debug build.
Underlying: `cmake --preset default`, `cmake --build --preset default`, `ctest --preset default`.

## Git workflow
Branch from `scaffold` (later `main`): `git checkout -b <role>/<topic>`. Commit small, rebase often. Directories have one owner, so merges should not conflict; if one does, ask. Do not rewrite shared branches. `build/` and `node_modules/` are ignored.
