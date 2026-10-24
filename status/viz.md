# viz (web: visualiser + mock VM)
Updated: 2026-10-24

## Done
- `web/mock_vm/`: `LoggingVm implements RVM` (kind `logging`), all 19 instructions, SPEC section 6 `forward`/`backward`
  (so `setDirection(-1)` runs the program as its own inverse), fault-before-write, input window, branch-on-host-action,
  undo journal for `stepBack`. Includes TS encoder/decoder (`isa.ts`), `.rvm` reader/writer (`image.ts`), a label-resolving
  `ProgramBuilder`, and sample programs (if/else, counting loop, call/return, framebuffer gradient).
- Vitest suite in `web/mock_vm/test/` (codec, semantics + faults, programs, timeline, randomized round trip).

- `web/viz/`: Vite + TS app. Panels: registers (changed ones flash), PC + disassembly window with labels, memory
  (data / stack / input window tabs, changed words highlighted), 64x32 canvas, time/direction/history/error. Controls: step,
  step back, run, rewind, speed, reset, sample picker, `.rvm` file loader, key capture. Mount point: `mountViz(el, vm, opts)`
  returns a handle with `slots.{toolbar,timeline,side}`, `on('update'|'load'|'run')`, `refresh()`; see `web/viz/README.md`.
- Keyboard encoding (games: please use): u32 per event, low byte = key code (ASCII upper-case, Space 0x20, Enter 0x0D,
  Esc 0x1B, arrows Up/Down/Left/Right = 0x80/0x81/0x82/0x83), bit 8 = released. `spec/input_tape.md` leaves this open.

## Merge 2026-10-24
- Merged origin/scaffold (12 commits: C++ logging + reversible VM, differential tests, SPEC section 11 UI requirements,
  key encoding now = keys.ts). Conflicts were only in spec/ and status/core.md (scaffold version taken). After the merge:
  mock_vm 47/47, viz 10/10, tsc clean, vite build ok.
- Corrected UI plan with milestones: `web/viz/UI_PLAN.md` (the old REVERSIBLE_COMPUTER_UI_PLAN.md could not be found).

## In progress
- Waiting for the user's go. Next: mock catch-up (below), then milestone 1 (tabs + machines list). Not yet looked at in a
  real browser; needs an eyeball pass on layout.

## Mock differs from the C++ logging VM (to fix, mock_vm)
- `loadProgram` clears the tape; C++ keeps it across `load_program` (core's note in status/core.md).
- Missing logging-VM faults from SPEC 6 rule 4: taken BR must land on an LND naming that BR; RET must be the PROC's declared
  exit and follow a CALL; stack slot above SP must be zero at CALL; RET to address 0 faults.
- CALL/RET stack check: mock requires the stack region, C++ requires any writable RAM word. Pick one (core to confirm).
- `historyBytes` is ~12 B/step in the mock vs ~48 B/step measured in C++; any "256 MiB" warning maths must not use the mock's number.

## Spec questions for core
- Who owns web/debugger: CLAUDE.md says a separate debugger role; there is no status file for them. Is it core?
- Viz currently has transport controls (step/run/speed). If the debugger brings its own, should viz hide its own?

## Verified (Node 24, 2026-10-24)
- `web/mock_vm`: `tsc` clean, 47/47 vitest tests pass (incl. 300 random programs round-trip and the d=-1 retrace).
- `web/viz`: `tsc` clean, 10/10 tests pass, `vite build` succeeds.

## Blocked / need from others
- Nothing.

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
