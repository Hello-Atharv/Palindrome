# core (user + Claude)
Updated: 2026-10-24

## Done
- Repo scaffold, CMake/presets/npm, placeholder CTest (passes on MSVC 2019).
- Spec v0.2: ISA (19 instrs), memory map, reference pseudocode, TS API (`spec/vm_api.ts`), C ABI, formats, asm syntax.
- Merged remote repo (sponsor notes, slides).

## In progress
- Logging VM (`vm/`), then minimal assembler (`asm/`).

## Blocked / need from others
- viz: first build `web/mock_vm`. games: Pong model + layout. debugger: timeline against the mock.

## Interfaces I changed or rely on
- Owns `spec/`. Tell me (via your status file) if the spec is wrong or unclear.
