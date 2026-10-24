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

## In progress
- Minimal assembler (`asm/`), then `if`/`loop` macros.

## Notes for others
- C++ namespace is `rev` (the C handle struct is `rvm`). The two VMs match on well-formed programs; only the `LND` assertion is logging-VM-only (SPEC section 7).
- Test helpers to build programs from raw words: `tests/test_util.h` (usable until the assembler exists).
- Tape persists across `load_program`; direction log does not.

## Blocked / need from others
- viz: first build `web/mock_vm`. games: Pong model + layout. debugger: timeline against the mock.

## Interfaces I changed or rely on
- Owns `spec/`. Tell me (via your status file) if the spec is wrong or unclear.
