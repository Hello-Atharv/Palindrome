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

## Milestones (updated 2026-10-24)
- M0 done: mock matches the C++ logging VM (BR/RET/CALL faults, LND prev tracking, tape persists across load, setInputTape
  only replaces the tape, 48 B/step + 8 B/flip history). mock_vm 53/53.
- M1 done: tabs (Debug/Code views; right: Memory/Screen/Compare[disabled]), machines list, virtualised listing with gutter,
  hooks for the debugger (listing API, slots incl. `left`/`code`, `update` event with t/maxT/branch/direction, host-action
  helpers). Signatures: web/viz/README.md. Keys only reach the machine while the Screen tab is open. viz 21/21.
- Decision to confirm: `branch` = true after a host action while t < maxT (a real fork); cleared on load.
- Design pass done (brief: time machine's control room): tokens + layout + panels + timeline hero (web/viz/src/styles/*), history
  tile with sparkline ("VM history", 48 B/step for the logging engine), tracker strip, direction -1 banner + frame, fault/halted/
  at-start banners, new-timeline badge + strip marker + discarded future, engine switch (Reversible disabled until WASM), Alt
  shortcuts, integer-scaled screen. 14 state screenshots at 1280x720 via `node scripts/screenshots.mjs`; no page scroll.
  viz 24/24, tsc clean, vite build ok.
- NOT done yet: CPU datapath diagram with travelling arrows (M3), Pong tab (M4), assembler hook (M6 uses asm/src/index.ts),
  real engine toggle. The "static state-switchable views with sample data" step was skipped: screenshots drive the real mock VM.
- Not measured: colour contrast ratios (palette chosen to be high contrast); native `title` tooltips on disabled controls do not
  show in screenshots.
- Fallback seek on the tape strip is a plain throttled runTo; the debugger should register `viz.timeline.onSeek`.

## Merge 2026-10-24 (WASM build, assembler, cipher)
- Merged origin/scaffold at 14ec2c2 (b070aaa WebAssembly build + benchmarks; 14ec2c2 Speck64/128 cipher). No conflicts.
  `web/wasm`: npm install + npm test = 38/38 pass. I did not edit web/wasm (core's).
- Now available: `createWasmVm('logging' | 'reversible')` from web/wasm/src/index.ts (same RVM interface), the assembler
  (`asm/src/index.ts`: assemble() with .if/.else/.fi and .loop/.again), programs/cipher.s, bench/RESULTS.md.

## Next (waiting for the user's go)
1. Factory swap: main.ts uses createWasmVm (keep the mock as fallback); add ../wasm/src and its lib typings to web/viz tsconfig.
2. Fix before swapping: registers.ts calls vm.code(pc, 1) unguarded; the wasm `code()` throws RangeError past the program
   (the mock returns 0). Guard on program.codeLen everywhere code() is called. Check the gradient/memory panel reads stay mapped.
3. Engine toggle (M6): enable the Reversible button; machines list holds one VM per engine; on switch, create the other VM,
   load the same image, replay the UI's own copy of the tape (API has no tape getter), and `runTo(t)`. Reversible shows
   "0 B" history in green (already styled).
4. Compare view: third right-hand tab, two machines in the list, every action applied to both, state-match badge on
   registers/PC/framebuffer, 256 MiB warning for the logging side (48 B/step).
5. Code view (M5): import assemble() from asm/src/index.ts; source in, diagnostics {severity, line, message} shown, listing
   rows {addr, word, line, text} and sourceMap for the listing; Assemble button calls viz.loadImage. Editor itself is the
   debugger's (slots.code); I supply the assemble hook and the diagnostics view.
6. Long runTo() blocks the page (web/wasm README): the fallback seek on the tape strip must chunk or the debugger must handle it.
7. Add programs/cipher.s to the picker once assembled in the browser (needs the assembler hook first).
- Unverified: whether Vite resolves asm/src's `./x.js` imports to `.ts` files in the browser build.
