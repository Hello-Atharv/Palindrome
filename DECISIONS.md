# Decisions

Status of every team-level decision. **Decided** = settled, build on it (details in `spec/SPEC.md`).
**Proposed** = a recommendation nobody has agreed yet; do not treat as settled. Owner of this file: core.
To change a decided item, tell core; spec-affecting changes go in `SPEC_CHANGELOG.md`.

## Decided
| Topic | Decision |
|---|---|
| What we claim | Reversible computing is old (Bennett, Janus, Pendulum). Ours is a complete, verified, interactive stack plus honest measurements. Never claim to have invented it. |
| Two engines, one API | Logging VM (oracle, benchmark baseline) and reversible VM (no per-step history). Same API. They must agree on `(registers, PC, writable memory)` and status at every instruction count. |
| Data model | 32-bit words, 16 registers, integers only, little-endian, wraparound arithmetic, no floating point, no multiply for now. |
| ISA | 19 instructions, each a bijection, inverses in `SPEC.md` section 4. No `MOV/AND/OR/CLEAR`; copy by `XOR` into a zeroed register; draw by `XOR`. |
| Control flow | `BR`/`LND` paired branches and `CALL`/`PROC`/`RET` (one entry, one exit per procedure). The logging VM asserts the rules. Fall back to Pendulum's scheme only if this breaks. |
| Direction | Host-set (`setDirection`), not an instruction. Direction flips are logged (8 bytes each). |
| Input | Program-owned cursor over a read-only, time-gated window. Any host action (key press, direction flip) at time t starts a new branch. |
| Memory | Separate code (64K words, read-only) and data spaces. Map: data, stack, 64x32 framebuffer, input window (`SPEC.md` section 5). |
| API | Web codes against `spec/vm_api.ts`; C++ against `spec/vm_api.h` (same operations). |
| Web boundary | Real C++ VM compiled to WASM (Emscripten). `web/mock_vm` implements the same TS interface until then. |
| Sort demo | Writes a permutation record to a fixed region; the UI highlights it as "garbage". |
| Demos | Pong (not Sokoban), then a reversible cipher, then the garbage-exposing sort. |
| Honest numbers | Report history bytes AND program garbage AND instruction overhead, including cases where reversible loses. |
| Roles | core (spec, vm, tests, asm, bench, demo), viz (web/viz, web/mock_vm), debugger (web/debugger), games (programs). Rules in `CLAUDE.md`. |
| Process | Read `spec/SPEC.md` and every `status/` file before a task; log spec changes in `SPEC_CHANGELOG.md` and flag them; edit only your own status file. |

## Proposed (not agreed yet)
| # | Topic | Recommendation |
|---|---|---|
| P1 | Assembler language | TypeScript in `asm/` (Node CLI + runs in the browser for live editing). |
| P2 | Web stack | Vite + TypeScript, no UI framework (fits Citadel's "handmade"). viz picks; tells debugger. |
| P3 | App structure | One app: viz owns the shell and a mount point; debugger builds a plug-in panel. |
| P4 | Frame concept | Reserved data word `FRAME` at `0xFFFF`, incremented once per frame by the program; debugger gets "step by frame". Needs a small spec change. |
| P5 | Git workflow | Branch from `scaffold` as `<role>/<topic>`; core merges to `main` at checkpoints. |
| P6 | Sponsor focus | Lead with Citadel (handmade) and HRT (honest data on the trade-off); Zed is a bonus. |
| P7 | Offline demo | Final demo runs from a local static build, tested on the demo laptop. |
| P8 | Milestones | Hour 4: assembler + mock VM + basic UI. Hour 8: reversible VM matches oracle, scrubber works. Hour 12: WASM in UI, Pong playable. Hour 16: feature freeze. Last 4 hours: tests, benchmarks, writeup, run-through. |
| P9 | Project name and writeup voice | Open. Someone with a good ear owns the jokes; every number must trace to `bench/`. |
