# CLAUDE.md

## Project
OxHack 2026 (theme: TIME). A **reversible computer**: a small ISA in which every instruction is a
bijection on machine state, so any program runs backwards with no history log.

Deliverables: (1) logging VM on a normal ISA, the correctness oracle; (2) reversible VM;
(3) assembler with macros; (4) demo programs (Pong or Sokoban, reversible cipher, a sort that
exposes its "garbage"); (5) web UI with CPU view, scrubber timeline and step-back debugger;
(6) honest benchmarks and a funny but truthful writeup. Judges are quant engineers and a
rigour-loving head judge: correctness and honest numbers beat features.

## Repo map and owners (one owner per directory)
| Dir | Purpose | Owner role |
|---|---|---|
| spec/ | ISA spec, C API, file formats | lead |
| vm/ | logging VM + reversible VM (C++17, static lib) | vm |
| asm/ | assembler + macros | asm |
| programs/ | demo programs in assembly | asm |
| tests/ | CTest tests, differential tests vs oracle | vm |
| bench/ | benchmarks (time and memory, both VMs) | lead |
| web/ (web/mock_vm/) | web UI; mock VM so UI can proceed early | web |
| demo/ | demo script, recordings, writeup | lead |
| status/ | one `<name>.md` per person | each person, own file only |

## Build and test
Needs CMake >= 3.21, a C++17 compiler (MSVC or Apple clang), Node (only to run npm scripts).
- `npm run build`: configure + build (Release)
- `npm test`: build, then run CTest
- `npm run dev`: configure + build Debug
Underlying: `cmake --preset default`, `cmake --build --preset default`, `ctest --preset default`.

## Rules
1. **Before any task, read `spec/SPEC.md` and every file in `status/`.**
2. **Any change to `spec/` must add a line to `SPEC_CHANGELOG.md` and be flagged to the user.**
3. **Update your own `status/` file when you finish a task; never edit someone else's.**
4. Stay in your directory. Need a change elsewhere? Ask that owner (or the user) via your status file.
5. The logging VM is the oracle: the reversible VM must match it at every instruction count.
6. LF line endings, 4 spaces for C++, 2 for web (see `.editorconfig`).
