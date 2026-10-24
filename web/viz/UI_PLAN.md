# UI plan (viz), corrected against SPEC v0.2 + section 11

`REVERSIBLE_COMPUTER_UI_PLAN.md` was not found in the repo or under OneDrive, so this replaces it. Facts below are from
`spec/SPEC.md` (sections 4, 5, 7, 11) and the user's corrections; where the spec is silent it says so.

## Facts the UI is built on
- 16 registers r0-r15 (r14 = SP), PC, 32-bit words, word addresses. No MAR/MDR/CIR, no 256-word memory.
- Code up to 64K words; data 64K; stack 64K (SP starts 0x10000); framebuffer 64x32 at 0x20000; read-only input window at 0x30000.
- The VM exposes registers, PC, memory, code and stats only. Datapath animation is inferred from the decoded instruction at
  PC plus snapshot diffs, and is labelled "illustrative".
- One ISA, one assembler. The engine toggle switches `logging` (about 48 B/step of history) vs `reversible` (0 B/step,
  8 B per direction flip). The C++ reversible VM exists; the mock is logging only, so the reversible option stays disabled
  until the WASM build lands.
- Input is a read-only, time-gated window (`input_tape.md`), not a blocking IN. No output device: framebuffer + hex watch.
- Keys: unchanged `keys.ts` (press = code, release = code | 0x100), now SPEC 11.7.
- FRAME counter: optional data word 0xFFFF (SPEC 11.7); used by "step by frame".
- Three different "backwards": step back / run back (time travel), the direction toggle (`setDirection`, program runs as its
  own inverse), and host actions (`pushInput`, `setDirection`) which start a new branch and reset `maxT`.

## Ownership
- web/viz: shell, tabs, CPU view, memory, framebuffer, mock VM, banners, machines list.
- web/debugger (mounted through slots): editor, listing, controls, timeline, watch panels, step over/out/frame,
  reverse watchpoint (SPEC 11.8). The transport buttons in viz are a fallback until the debugger mounts its own.

## Milestones (no code until the user says go)
0. **Mock catch-up** (small, before UI work): match C++ logging VM fault rules and tape persistence (see status/viz.md).
1. **Layout shell with tabs.** Tabs Debug / Code / Compare (Compare disabled); right-hand tabs for Memory / I/O (Pong).
   Slots: `left` (debugger pane), `timeline`, `toolbar`, `side`. `machines: Machine[]` instead of one `vm`; one `refresh()`
   builds one snapshot per machine; panels are functions of (snapshot, previous).
2. **Controls on the mock.** Step, step back, run, pause, run back, **stop = reset to t=0 keeping the program**, pause = hold t.
   Separate direction toggle with a banner when direction is -1. "New branch" indicator; track `maxT`, reset on host actions.
   Timer strip: t, steps/s, FRAME, optional wall clock.
3. **CPU diagram + animation.** Registers, PC, decoded instruction, ALU/memory/branch highlights from decode + diff. Animate
   at <= ~20 steps/s; faster switches to pulse / heat-map. Labelled illustrative.
4. **I/O boxes + Pong tab.** Input window panel (TIME, COUNT, events), hex watch panel, framebuffer. Keys captured only while
   the Pong tab has focus. Show whatever program is loaded; gradient sample is the fallback. A JS-only Pong, if ever shown,
   is labelled as a fallback.
5. **Assembler hook.** Stub `assemble(src) -> {image, errors}`; breakpoints on disassembly addresses first, source lines later
   (`.rvm.map` format not final).
6. **Engine toggle.** Keep the UI's own copy of the input tape (no tape getter in the API) and replay `runTo(t)` on switch.
   Compare becomes the third right-hand tab; warn at 256 MiB of logging history.

## Performance rules (SPEC 11.1)
Per animation frame read only: 16 regs + PC, the framebuffer (2048 words), the visible memory window (~256 words),
`historyBytes`. Full 520 KiB scans at most a few times per second (minimap, "memory in use").
