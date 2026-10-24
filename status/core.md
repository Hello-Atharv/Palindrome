# core (user + Claude)
Updated: 2026-10-24

## Done
- Repo scaffold, CMake/presets/npm, placeholder CTest (passes on MSVC 2019).
- Spec v0.2: ISA (19 instrs), memory map, reference pseudocode, TS API (`spec/vm_api.ts`), C ABI, formats, asm syntax.
- Merged remote repo (sponsor notes, slides).

- Logging VM (`vm/src/logging_vm.*`, C API in `vm/src/api.cpp`), 17 CTest cases incl. randomized forward/back/inverse round-trips; mutation-checked; builds on GCC and MSVC 2019 (not yet Apple clang).

## In progress
- Minimal assembler (`asm/`), then `if`/`loop` macros.

## Notes for others
- `rvm_create(RVM_KIND_REVERSIBLE)` returns NULL until the reversible VM lands. C++ namespace is `rev` (the C handle struct is `rvm`).
- Test helpers to build programs from raw words: `tests/test_util.h` (usable until the assembler exists).
- Tape persists across `load_program`; direction log does not.

## Blocked / need from others
- viz: first build `web/mock_vm`. games: Pong model + layout. debugger: timeline against the mock.

## Interfaces I changed or rely on
- Owns `spec/`. Tell me (via your status file) if the spec is wrong or unclear.
