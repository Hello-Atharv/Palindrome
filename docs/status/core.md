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

- **examples/demos/cipher.s**: Speck64/128 reversible cipher on the screen (plaintext pixels turn to noise), matches the published test vector on both engines, no garbage, decrypts via direction -1.

- **examples/demos/sort.s**: reversible sort on the screen (row 0 list, row 1 garbage), network proven on all 0/1 inputs, 25 random inputs + unsort tested on both engines. Macro doc corrected: only the `.fi` assertion registers matter.
- **Playground** (`web/wasm/playground`, `npm run playground`): the real engines in a browser, with a **Compare engines** view (history 0 B vs a rising diary, states-match badge, history chart), screen zoom, memory jump buttons. Screenshot-checked in Chrome. Proves Vite resolves the assembler's `.js` imports to `.ts`. 54 wasm tests.

- **Macros for reversible programming** (`asm/src/macros.ts`): `.with`/`.endwith` (constants), `.compute`/`.use`/`.uncompute` (the assembler writes the undo; checks the use block does not change an input), `.plot` (XOR a pixel). 14 new tests.
- **examples/demos/pong.s** rewritten with them and procedures: 275 instructions, 238 lines of plain source (was 487 instructions, 524 generated lines), ~400 steps/frame (was 300). 14 tests per engine against an independent model after every frame; mutation-checked. Score is a yellow 2x2 block per hit. Playground plays it (keyboard wired).

- **Cost model** (SPEC section 12, logged in `spec/CHANGELOG.md`) and **demo script** (`docs/DEMO.md`): one definition of history, garbage, bits erased and overhead; fair-baseline rules; planned vs built labelled.

- **Fair baselines** (`bench/twins`, `bench/TWINS.md`): a conventional machine, conventional twins of sort and Pong (same pictures as the reversible programs on the real engines, every frame), a real bit-packed tight diary that rewinds exactly, checkpoint-and-replay that seeks exactly. 9 tests, mutation-checked. Findings: reversible costs ~3x the instructions; tight diary for Pong ~126 B/frame vs reversible 8 B/frame; checkpointing every 10k steps (~15 B/frame) is a serious competitor on this small-state program.

- **Compiler** (`lang/`, `rev` language, Janus family): lexer/parser, reversibility checks, code generator to assembly (br/lnd, call/proc, expression temporaries built then un-built), source-level inverse for `uncall`, and a **cost report** (`npm run rvmc -- prog.rev --report`): steps per source line, garbage, history bytes, exact round trip on both engines. 35 tests against a reference interpreter on the real engines, mutation-checked. Stage 3 done: arrays, memory-resident scalars (spill beyond 9 registers), absolute placement (`@ 0x20000` reaches the framebuffer), `events`/`latest` input atoms, array elements in `if` tests. `examples/rev/sort8.rev` (36 lines) compiles to 438 instrs / 335 steps vs the hand-written sort.s at 341 / 311 (+28% code, +8% steps, same 14 garbage bits). Not done: recursion, multiply/shifts, `logged`, language server.
- **Playground rev editor** (`web/wasm/playground`): four rev programs (`?p=6..9`) with a source editor, *Compile & load* (compiles in the browser), the assembly the compiler wrote in the Code panel, and the per-line cost report beside it. Checked in headless Chrome: rev Pong runs and the report renders.
- **VS Code extension** (`vscode/`): TextMate grammars for rev and the assembly, diagnostics as you type, cost beside each source line on save, status-bar summary, `rev: Show cost report`, and a terminal debugger command. 8 tests: grammars tokenised with the engine VS Code uses (found and fixed a real rule-order bug), editor logic, bundle smoke-run in Node. **The editor glue (`src/extension.ts`) has not been run in a real VS Code window**; F5 launch config included.
- **Playground editor upgrade**: the rev editor now colours as you type and underlines errors live from the compiler (the same checks as the VS Code extension; `highlight.ts`, 4 tests); `?src=` loads source from the URL. Arrow/W/S keys no longer scroll the page when held (auto-repeats were not being `preventDefault`ed), dropdowns release keyboard focus, and Pong shows a visible `Score` readout (yellow blocks / 4).
- **Pong in rev** (`examples/demos/pong.rev`): identical court to `pong.s` on every frame over 250 frames (`lang/test/pong.test.ts`), plus a permanent wall (column 32, never erased) and the score drawn as two digits (3x5 font) instead of yellow blocks. `rvm verify` passes. Like-for-like before those additions: 465 instrs vs 275, 488 steps/frame vs 399; now 601 instrs, ~530 steps/frame (it does more). **Compiler bug found and fixed while doing this:** constants held in temporaries across an if/loop body broke any procedure call inside it (callees assume all temporaries are zero); they are now loaded just before they are read and cleared right after; regression tests added. Found: step-by-frame must wait for FRAME == start+1 (SPEC 11.7 amended and logged), since a move-idiom update passes through zero.

- **`rvm` CLI** (`cli/`): `build`, `run`, `report`, `verify`, `debug`. `verify` checks a program on both engines (assertions, lockstep agreement, 200 random scrubs, full undo/replay, direction -1) and says it is testing, not proof; passes the cipher, sort, Pong and the examples. `debug` is a gdb-style debugger with source-line step **back**, breakpoints, `rwatch` (who last wrote this?) and identical transcripts on both engines. The debugger logic (`cli/src/debugger.ts`) is headless over `spec/vm_api.ts` so `web/debugger` can reuse it; The placeholder `web/debugger/` folder has since been removed. 14 tests, mutation-checked.

- **Console** (SPEC 11.9): `.print` macro in the assembler (strings, characters, unsigned/signed/hex; 13 instructions per character, each entry appears in one step), a `print` statement in `rev` (undone by `uncall`, counted as garbage by the cost report), `lang/src/console.ts` to read it back for any UI, `rvm run` prints it, the debugger has `console`. 11 assembler tests, 5 engine tests, 14 language tests. A test found that updating the length by moving it through zero showed an empty console mid-print; the length now changes in one step.

- **Optional `fi` and warnings** (`lang/`): an `if` without `fi` gets the test as its assertion when no branch (or procedure it calls) changes what the test reads and the test uses only registers and constants; otherwise a compile error says exactly why. The inferred code is byte-identical to writing the same `fi` (tested for all six relations). `examples/demos/pong.rev` lost 7 redundant `fi`s and compiles to the identical image. Warnings (a `fi` that repeats the test after a branch changed it; a `fi` no branch can influence and that is not the test) reach `rvmc`, the VS Code extension and the browser editor (yellow underline). The cost report says how many `if`s had an inferred vs a written `fi`. 12 new tests, mutation-checked.

- **Frame tracker** (`web/wasm/src/frames.ts`, 18 tests on both engines and both Pong versions, mutation-checked): exact `stepFrame`/`backFrame`/`goToFrame` for programs that count frames, by recording the time each frame completed (the FRAME word passes through zero mid-update and no value test works backwards). The playground uses it; in headless Chrome the paddle is fully drawn in every redraw with it (paddleMin 4) and not without (0). Atharv's UI should import it rather than copy the logic.

## In progress
- Benchmark chart for the demo (Atharv's UI), the showpiece, the writeup, and a README that gets a stranger from clone to demo.

## Notes for others
- C++ namespace is `rev` (the C handle struct is `rvm`). The two VMs match on well-formed programs; only the `LND` assertion is logging-VM-only (SPEC section 7).
- Real VM in the browser: `web/wasm` (`createWasmVm('reversible'|'logging')`), same interface as the mock. UI people: swap the factory; the engine toggle can now be enabled.
- Test helpers to build programs from raw words: `tests/test_util.h` (usable until the assembler exists).
- Tape persists across `load_program`; direction log does not.

## Blocked / need from others
- viz: first build `web/mock_vm`. games: Pong model + layout. debugger: timeline against the mock.

## Interfaces I changed or rely on
- Owns `spec/`. Tell me (via your status file) if the spec is wrong or unclear.

## 2026-10-25 bug fixes
- Stack bounds enforced in both engines (CALL/RET and inverses fault outside 0x10000..0x1FFFF); WASM rebuilt.
- rev: a constant array index outside the array is a compile error.
- Console: capacity limit (4,095 entries) documented in SPEC 11.9; consoleOverflowed() + rvm run warning. Not prevented at runtime (a guard needs a third scratch register in .print; open).

## 2026-10-25 input race fix
- Found by Atharv's UI report plus a key-race test: pong.rev read the input twice, so a key landing between the reads left a temporary non-zero and the logging engine failed an LND assertion. Fixed: events/latest only straight into a register (`v ^= latest;`), new window word LATEST at IN_BASE+0xFFFF (spec/input_tape.md), pong.rev records then clears from the record. web/wasm/test/keyrace.test.ts injects keys at every offset of a frame.
- Needs from viz (Atharv): web/mock_vm/src/tape.ts must also return LATEST at window offset 0xFFFF so the mock matches the engines.
- Open: pong.s did not fail in any of my tests, so his earlier pong.s LND report is unexplained (his later 180-session driver found none).

## 2026-10-25 playground retired
- web/viz is the one browser UI. It now has the rev editor with errors as you type (web/viz/src/revtools.ts calls lang/) and the per-line cost report after Build. web/wasm/playground, its Vite config and its highlighter test are deleted; docs updated (README, GUIDE, ARCHITECTURE, DEMO, WRITEUP, CLAUDE.md). The playground-only test options (selftest, debug) are gone.
