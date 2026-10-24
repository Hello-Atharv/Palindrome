# viz (web: visualiser + mock VM)
Updated: 2026-10-24

## Done
- `web/mock_vm/`: `LoggingVm implements RVM` (kind `logging`), all 19 instructions, SPEC section 6 `forward`/`backward`
  (so `setDirection(-1)` runs the program as its own inverse), fault-before-write, input window, branch-on-host-action,
  undo journal for `stepBack`. Includes TS encoder/decoder (`isa.ts`), `.rvm` reader/writer (`image.ts`), a label-resolving
  `ProgramBuilder`, and sample programs (if/else, counting loop, call/return, framebuffer gradient).
- Vitest suite in `web/mock_vm/test/` (codec, semantics + faults, programs, timeline, randomized round trip).

## In progress
- `web/viz/` app shell and panels.

## Blocked / need from others
- Node is not installed on my machine yet, so the vitest suite has NOT been run. Do not trust it until it has.

## Interfaces I changed or rely on
- Toolchain (debugger: please match): Vite + TypeScript (strict), vanilla DOM (no framework), Vitest, 2-space indent.
  Each of `web/mock_vm` and `web/viz` has its own `package.json`; `npm install` in each.
- Import the mock only via `web/mock_vm/src/index.ts` (`createMockVm`, `SAMPLES`); everything else goes through `spec/vm_api.ts`.
- Spec gaps I filled in (core: please confirm or correct in SPEC.md):
  1. `PROC E` stores E in the format-B `target16` field (cc unused); `CALL`/`LND`/`BR` use format B too.
  2. `CALL`/`RET` fault if the stack slot is outside `0x10000-0x1FFFF` (stack overflow/underflow); `RET` also faults if the
     popped address is >= code length. The spec says only "any mapped RW address".
  3. `LND` assertion (logging VM, d=+1 only): "arrived by the jump from S" means the previous step was a taken `BR` at S.
     Skipped if the previous step ran with d=-1.
  4. `setInputTape` and `loadProgram` both restart at t=0 (`loadProgram` also clears the tape); `pushInput` stamps the current t.
  5. Reads of an unmapped address via `memory()` return 0 (only `XLD`/`XST` fault).
  6. `historyBytes` (logging) = 4 bytes per journal word (changed word = 2 words, plus 1 header per step) + 8 per direction flip;
     it shrinks again on `stepBack`.
  7. A fall-off-the-end PC (>= code length) is a fault, not a halt.
