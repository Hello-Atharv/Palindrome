# core (user + Claude)
Updated: 2026-10-24

## Done
- Repo scaffold, CMake/presets/npm, placeholder CTest (passes on MSVC 2019).
- Spec v0.2: ISA (19 instrs), memory map, reference pseudocode, TS API (`spec/vm_api.ts`), C ABI, formats, asm syntax.
- Merged remote repo (sponsor notes, slides).

- Logging VM (`vm/src/logging_vm.*`, C API in `vm/src/api.cpp`), 17 CTest cases incl. randomized forward/back/inverse round-trips; mutation-checked; builds on GCC and MSVC 2019 (not yet Apple clang).

- **Reversible VM** (`vm/src/reversible_vm.*`): no per-step history, step_back computes the inverse (SPEC section 6). Shared state/API in `vm/src/machine.*`. `rvm_create(RVM_KIND_REVERSIBLE)` now works; history is 0 bytes per step (8 per direction flip).
- `tests/differential_test.cpp`: random scrub walks (step, step back, run_to, set_direction, push_input) on both VMs over structured, input-reading and random programs, comparing state after every action; plus a 200,001-step rewind with 0 bytes of history. Mutation-checked: breaking the step-back time, the RET undo, or the ROLI inverse is each caught.
- Fixed: `run_to` could loop forever if a step back failed.

- **Assembler** (`asm/`, TypeScript): all 19 instructions, pseudo-ops, `.data/.word/.space/.equ/.entry`, expressions, operand and control-flow checks with source lines, `.rvm` writer, listing, source map v1, Node CLI (`rvmasm`). 33 unit tests plus 12 integration tests that assemble the examples and run them on both C++ engines with rewind and replay (via the new `rvm_run` tool).
- `vm/tools/rvm_run.cpp`: run a `.rvm` on either engine (`--engine`, `--rewind`, `--mem`, `--tape`, `--dir -1`).

- **Macros**: `.if/.else/.fi` and `.loop/.again` (nestable), expanding to the exact hand-written code; hidden `$` labels; 62 assembler tests including nested.s on both engines with rewind and replay.

- **WebAssembly build** (`vm/wasm`, `web/wasm`): both engines behind the `RVM` interface, single-file module committed (42 KB). 25 tests: examples through the assembler on both engines, rewind and replay, faults, and random-scrub differential tests between the engines in wasm. `npm run build:wasm` rebuilds (needs the Emscripten SDK; installed at ~/emsdk on core's machine).
- **Benchmarks** (`bench/`): speed and history memory of both engines; results with spread and caveats in `bench/RESULTS.md`. Headline: 48 B/step diary vs 0 B; reversible rewind is slower (2 to 5x), forward is faster.

- **programs/cipher.s**: Speck64/128 reversible cipher on the screen (plaintext pixels turn to noise), matches the published test vector on both engines, no garbage, decrypts via direction -1.

- **programs/sort.s**: reversible sort on the screen (row 0 list, row 1 garbage), network proven on all 0/1 inputs, 25 random inputs + unsort tested on both engines. Macro doc corrected: only the `.fi` assertion registers matter.
- **Playground** (`web/wasm/playground`, `npm run playground`): the real engines in a browser, with a **Compare engines** view (history 0 B vs a rising diary, states-match badge, history chart), screen zoom, memory jump buttons. Screenshot-checked in Chrome. Proves Vite resolves the assembler's `.js` imports to `.ts`. 54 wasm tests.

- **Macros for reversible programming** (`asm/src/macros.ts`): `.with`/`.endwith` (constants), `.compute`/`.use`/`.uncompute` (the assembler writes the undo; checks the use block does not change an input), `.plot` (XOR a pixel). 14 new tests.
- **programs/pong.s** rewritten with them and procedures: 275 instructions, 238 lines of plain source (was 487 instructions, 524 generated lines), ~400 steps/frame (was 300). 14 tests per engine against an independent model after every frame; mutation-checked. Score is a yellow 2x2 block per hit. Playground plays it (keyboard wired).

## In progress
- Conventional twin of the sort and of Pong for the honest overhead benchmark.

## Notes for others
- C++ namespace is `rev` (the C handle struct is `rvm`). The two VMs match on well-formed programs; only the `LND` assertion is logging-VM-only (SPEC section 7).
- Real VM in the browser: `web/wasm` (`createWasmVm('reversible'|'logging')`), same interface as the mock. UI people: swap the factory; the engine toggle can now be enabled.
- Test helpers to build programs from raw words: `tests/test_util.h` (usable until the assembler exists).
- Tape persists across `load_program`; direction log does not.

## Blocked / need from others
- viz: first build `web/mock_vm`. games: Pong model + layout. debugger: timeline against the mock.

## Interfaces I changed or rely on
- Owns `spec/`. Tell me (via your status file) if the spec is wrong or unclear.
