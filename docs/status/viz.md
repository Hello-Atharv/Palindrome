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

## Real engines wired (2026-10-24, merged dbc8a2e)
- Done: `createWasmVm` (real logging + reversible VMs) wired in `src/main.ts` with fallback to the mock; engine switch (replays
  program, inputs, direction flips and t on a fresh VM); Compare view (two machines in a list, every action applied to both,
  state-match badge, per-side history and non-zero-word counts, 256 MiB warning on the diary); Code view with the real
  assembler (`asm/src/index.ts`, passed in as a hook): diagnostics by line, listing, Assemble & load; all demo programs
  assembled in the browser (cipher, sort, asm examples); Memory view ASCII column, jump-to-label, hatched garbage words.
  `code()` calls guarded. 20 screenshots on the real engines at 1280x720, no page scroll, no console errors.
  Tests: viz 33/33 (incl. real wasm engine-switch replay and Compare), mock_vm 53/53, tsc clean, vite build ok (126 kB JS).
- Not done: M3 CPU datapath diagram + arrows; Pong tab; chunked runTo for the fallback scrubber (nothing blocks on the demos).
- Things I hit: (1) the mock's `memory()` and the wasm one agree (unmapped = 0); (2) `viz.vm` now changes on engine switch, which
  the debugger must not cache; (3) host actions made outside `viz.pushInput/setDirection` cannot be replayed on a switch;
  (4) loadProgram keeps the VM's tape, so the shell clears it with an empty tape on every load (each run starts with no inputs);
  (5) the program picker did not follow programs loaded through the API: fixed.

## Learn view (2026-10-24)
- Done: the datapath view modelled on a classroom CPU simulator (user request): program | animated datapath | fixed 64 data +
  16 stack word memory window (signed/unsigned/hex). Inferred, labelled illustrative. Forward = amber packets, back / direction -1 =
  the same script reversed in cyan. Simple programs only (<= 30 instructions, <= 32 data words); sort, cipher and Pong disable the
  tab with a reason. Replaces the old M3 (CPU diagram). New files: src/datapath/{script,layout,diagram}.ts, src/panels/learn.ts,
  src/styles/datapath.css. SPEEDS now 1, 2, 5, 10, 100 ... Screenshots 21-28. viz 49/49 tests (16 new), tsc clean, vite build ok.
- Differences from the model's UI that I could not match: no status flags N Z C V (the ISA has none, so a "Condition" box); no
  byte mode (word-addressed memory); separate program memory, so fetch does not use MAR/MBR; input is a read-only window.
- Known gaps: the bus is drawn as one shared path, not separate buses; registers and memory values change when the packet arrives
  only for registers (memory words update when the whole instruction finishes); no editable source in Learn (use Code view).

## IDE layout redesign (2026-10-24)
- Done (user request): Debug and Code combined into one VS Code-style left side (editor with breakpoint gutter + current line, a
  compact debug bar at its foot, collapsible with a button or Ctrl+B); registers and memory removed from that screen. Right side:
  Visualisation (datapath, one sphere at a time on a wire, constant speed, Slow/Normal/Fast, the wire filling in behind it, runs
  wait for the animation), Output (screen, labelled values as numbers and text, registers, memory inspector), Compare (forward
  track and back track measured on both engines, time and memory with bars; plus the live side-by-side).
- avoid-ai-design: scanner 5 findings (glyphs as icons) -> 0. Replaced glyph icons with SVG icons, all-caps tracked titles with
  sentence case, pill badges with plain text, glow chrome with flat 1px borders. Palette is the project brief's.
- `Listing hooks` moved to the editor (same ListingApi). New: `viz.listing` fallback breakpoints (only while nobody listens),
  `setSidebar` via UI, `Runner` options `gate` and `stopAt`. Removed: tracker panel, listing/code/learn panels, hero timeline.
- Tests: viz 55/55 (new: editor hooks, layout, sidebar, measurement), tsc clean, scanner 0. Screenshots 01-16.
- Compare result on sort (159 steps): forward 9.0 us diary vs 4.6 us reversible; back 4.4 us vs 5.4 us; history 7.5 KiB vs 0 B.

## Workbench changes (2026-10-24, web/viz only)
- Time bar is now a thin line; assembly is syntax-coloured; the editor resizes by dragging the divider and the collapse button
  sits on the divider (Ctrl+B still works); the visualisation uses solid, brighter parts and light-gridded memory and stack tables
  with decimal row numbers; "add two numbers" example plus a "Send a number" box (Visualisation and Output).
- Not yet "implemented into the system" (the user will say when): nothing outside web/viz changed. The example lives in
  web/viz/src/examples.ts, not in programs/ or asm/examples/.
- Reversibility of the example: tested on both engines (logging and reversible), forward 7 steps then back 7 steps restores every
  register and memory word; the reversible engine holds 0 bytes of history. Caveat (SPEC 7): under direction -1 an input-reading
  program is not exactly self-inverse, because the input window follows machine time; step back is always exact.
- viz 70/70 tests (15 new), tsc clean, scanner 0, build ok.

## Workbench round 2 (2026-10-25, web/viz only; scaffold 95b2fa1 merged first, no conflicts)
- Run-time bar: the image's design (`t N`, track with an amber knob, state), no pre-run. Capacity is what the speed gets through in 5 s
  (20 instructions when the animation paces the run, 5 x speed otherwise, 500,000 at top speed) and the label says so. It fills, then
  slides: the right end is always the latest t. One speed control in the debug bar (Slow / Normal / Fast / Instant for animated
  programs, steps per second otherwise); the Animation buttons and the number-format select are gone.
- Resize bug: the right side keeps at least 560 px, the memory column is sized for its rows, the note no longer wraps one word per
  line, and `npm run test:layout` (Playwright, real browser) drags the divider across widths at four window sizes on every tab: 60
  layouts, no overlap or clipping. It caught a clipped row-label column while I was building.
- Numbers are signed decimal everywhere (hex only for instruction words). One main memory (Program / Data / Stack, sticky headers,
  `P00003` / `D00060` / `S65536`) scrolls to where the machine works; fetch is drawn PC, MAR, memory, MBR, CIR. The machine is
  unchanged (Harvard, code read-only); the page says so.
- Output tab: console (SPEC 11.9, read with `lang/src/console.ts`, rewinds with time, Lock scroll, no Copy) beside the screen, then
  Send a number and Send keys (with the last key). No registers or memory there. "add two numbers" now prints both inputs and the
  sum; that made it 46 instructions, so the animation limit went from 30 to 64 (LEARN_MAX_CODE). "my program" is a blank template
  with edits kept per program in localStorage. Pong is in the picker.
- Compare: "Compare engines" in the header (or the tab) hides the editor and runs both engines in lockstep; program, transport, speed and
  run-time bar are at the top, and the program picker there is synced with the header. Cards show history_bytes, garbage_bits (console
  counted), total, data written, registers, screen, last console lines and ns per step. A "VM history against time" chart and table;
  tight diary and checkpoint-and-replay are labelled planned (SPEC 12.4). Runs are the first 100,000 steps unless the program halts,
  hard cap 5,000,000. The old side-by-side toggle and the "states match" badge are gone (a mismatch still pauses and shows a line).
- Stale test: engines.test expected sort.s to have a `garbage` data label; core moved sort's garbage onto the screen, so the test now
  uses a small inline source.
- Tests: viz 72/72, tsc clean, scanner 0, build ok.

## Round 3: Pong, rev programs, benchmarks (2026-10-25, web/viz only; merged scaffold 6d8da33)
Building (so nobody duplicates it): frame stepping and the frame number in the UI, Pong and pong.rev in the picker, a rev compile and
cost-report path, and a drawing of bench/results.json. All in web/viz; nothing outside it changed except moving this file.
- Merge: one conflict, status/viz.md (now docs/status/viz.md). Paths updated to examples/demos, examples/asm, examples/rev.
- Frame stepping: `FrameTracker` imported from web/wasm/src/frames.ts, not copied. A run redraws only at frame ends (forward:
  `observe()`, back: `atBoundary()`), sync is off while direction is -1, `truncateAfter` on a key or direction flip, a new tracker after an
  engine switch, the time bar snaps to a frame boundary and shows `frame N` (t moves to its label). Buttons: Back one frame, Forward one
  frame. Tested on both engines: Back one frame returns to the exact state seen going forward, key press included.
- Keyboard: `preventDefault` now runs before the auto-repeat check (it ran after, so a held arrow key could scroll the page); selects blur
  after a change. `scripts/pong-check.mjs` plays Pong in Chromium with a held key: no scrolling, the paddle moves.
- Direction -1: not hidden; tooltip and banner say it is not exactly self-inverse for programs that read input, use Back.
- Game note (copied wording), score (one yellow block per hit, counted from the screen), input log (8 bytes a frame).
- rev: `compile` hook adapts lang/src/compile.ts (diagnostics and the listing are mapped through its `lineMap` to rev lines); rev colours;
  Cost report button runs `analyze`/`formatReport`. pong (rev), hello (rev, prints), fibonacci (rev) are in the picker.
- Benchmarks: bench/results.json is imported as text and drawn (log-log memory against steps to seek, naive diary labelled naive, tight
  diary, checkpoints, reversible) with a table; Sort has a table only (no seek or checkpoint data). NOT built: a live conventional twin
  lined up by frame; the twin would have to run in the page and nothing in web/ runs it.
- Asked of core / noticed: (1) the frame helper was enough, nothing missing. (2) `npm run test:all` does not include web/viz's tests;
  suggest adding `npm --prefix web/viz test`. (3) I could not run `npm run test:all` here: no CMake on this machine. I ran viz tests
  (82), tsc, the scanner, the layout check and the Pong check; I did not run the C++, asm, wasm, lang, cli, twins or vscode suites.

## Round 4 (2026-10-25, web/viz only)
- Datapath arrows are smaller (marker 6 -> 3.6) and the control unit and the condition box are moved clear of the CIR and the bus so their
  arrows are visible (30+ units of wire each; a test guards it).
- Custom speed: "custom..." in the speed menu takes thousands of steps per second (2.5 = 2,500/s); it also sets the time-bar capacity.
- `.s | .rev` switch in the header for programs that exist in both languages: pong and sort (sort8.rev). One picker entry each
  (`ProgramEntry.alt`). Drafts are kept per language.
- The Cost report is gone from the Output tab (panel, hook and styles removed).
- Compare: the two screens are as big as the card allows (up to 6x, 384 x 192).
- Tests: viz 84/84, tsc clean, build ok, scanner 0, layout check 60/60.
