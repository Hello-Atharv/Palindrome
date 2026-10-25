# web/viz/
The visualiser and app shell, laid out like an IDE. Imports `spec/vm_api.ts` only; the VM is injected.
Owner: **viz**. The debugger (`web/debugger/`) mounts into this shell and never edits it.

Toolchain: Vite + TypeScript (strict, vanilla DOM) + Vitest (+ jsdom for the shell tests), 2-space indent.
`npm install`, then `npm run dev` / `npm test` / `npm run build`.

## The screen
```
+--------------------------------------------------------------------------------------------+
| Reversible machine           [Diary|Reversible] [program v] [Open .rvm file] [Compare engines] |
+-----------------------------+--------------------------------------------------------------+
| editor (source or           |  Visualisation | Output | Compare                              |
| disassembly), gutter with   |                                                                |
| breakpoints, current line   |  the datapath with a travelling sphere, and one main memory    |
|                             |  (Program, Data, Stack) beside it                              |
| ----- debug bar ----------- |                                                                |
| [small icon controls] speed |  Output: console + screen, then the input boxes                |
| Run time, full at N         |  Compare: both engines side by side, memory against time       |
| t 120 ----o-------- ready   |                                                                |
+-----------------------------+--------------------------------------------------------------+
```
The left side (editor + debug bar) collapses completely: the button on the vertical divider or **Ctrl+B**, as in VS Code.
Drag the divider to resize the editor (260 px up to 70% of the width, but never so wide that the right side falls under 560 px;
the width is remembered), double-click it to reset. Assembly is syntax-coloured by `src/highlight.ts`, drawn behind a
transparent textarea. Edits to any program are kept in this browser (localStorage, per program name) and come back when that
program is picked again.

- **Editor.** Assembly source (editable; **Build and load**, or Ctrl+Enter) or, for a program without source, its disassembly.
  Line numbers, a breakpoint gutter, the current instruction highlighted, assembler problems listed under the text.
- **Debug bar.** Small icon buttons (stop, run back, step back, step, run/pause, reverse program) and **one speed control**: for a
  program the visualisation animates it is Slow / Normal / Fast / Instant (how fast the sphere moves; Instant skips the animation),
  for everything else it is steps per second. A game (a program with `game` info, see below) also gets **Back one frame** and **Forward one frame**. Under it the **run-time bar**: `t N`, a track with a knob, the state. Alt+`,` step
  back, Alt+`.` step, Alt+Space run/pause, Alt+0 stop.
- **The run-time bar** never runs the program to find its length. Its width is a capacity: 20 instructions when the animation sets
  the pace, otherwise 5 seconds at the current speed (1,000/s is 5,000 instructions; 2/s is 10; top speed is fixed at 500,000), and
  the label says so. It fills from the left until it is full, then slides: its right end is always the latest `t`, its left end
  one capacity earlier, and the number at the left keeps counting. Drag the track to move through time (up to the furthest point
  reached). Changing the speed changes the scale.
- **Visualisation** (simple programs only: at most 64 instructions and 32 data words). One sphere at a time travels along the wire
  the instruction uses, the wire filling in behind it and the value riding above it. Fetch goes PC, MAR, main memory, MBR, CIR.
  A run waits for the animation. A step back, or a step while the direction is -1, plays the same wires in reverse in cyan.
  **Main memory** is one scrolling table with Program, Data and Stack under headers that stay in view; every row has a lettered,
  zero-padded address (`P00003`, `D00060`, `S65536`) and numbers are signed decimal (instruction words are the only hex). It
  scrolls to where the machine is working. It is a presentation: the real machine keeps code apart from data and read-only (a
  Harvard architecture, by design). Bigger programs (sort, cipher, Pong) open in the Output tab instead.
- **Games** (Pong). `ProgramEntry.game` marks a program that counts frames in the FRAME word (SPEC 11.7). The shell uses core's
  `FrameTracker` (`web/wasm/src/frames.ts`, imported, not copied): a run redraws only at the end of a frame (XOR drawing erases before it
  redraws, so a picture taken mid-frame is half erased), frame sync is off while the direction is -1, a key press or direction flip
  after scrubbing back calls `truncateAfter`, and dragging the time bar snaps to a frame boundary. The time bar shows the **frame
  number** and moves `t` into its label. The Output tab shows a note, the frame, the score (one yellow block per hit for `pong.s`)
  and the input log, the only garbage Pong keeps. Every handled key gets `preventDefault`, auto-repeats included, so a held arrow key
  does not scroll the page, and dropdowns give up focus after a change so the arrows reach the game. Direction -1 is not hidden but is
  warned about (tooltip and banner): it is not exactly self-inverse for programs that read input; use Back.
- **rev programs.** An entry with `language: 'rev'` is compiled with `lang/src/compile.ts` (the `compile` hook of `mountViz`): the
  editor shows rev source with rev colours, and the current line follows the compiler's line map. **Cost report** (the `report` hook,
  `lang/src/report.ts`) runs the program on fresh engines and prints steps per line, garbage and history.
- **Output.** The console (SPEC 11.9) beside the 64x32 screen, then the ways to give the machine input: **Send a number** and
  **Send keys to the machine** (with the last key). The console reads the print buffer back out of memory at the current time with
  `lang/src/console.ts`, so stepping back un-prints; it follows new lines unless **Lock scroll** is on, and a program that never
  prints shows nothing there. No registers and no memory: those are in the Visualisation tab. Keys reach the machine only while this
  tab is open.
- **Compare.** The **Compare engines** button in the header (or the tab) hides the editor and runs both engines in lockstep on the
  program shown; the program, the transport buttons, the speed and the run-time bar are at the top of the tab, and changing the
  program there changes it in the editor too. The Diary | Reversible switch is locked while comparing. Each engine's card shows its
  history memory (`history_bytes`), garbage (`garbage_bits`, with the console buffer counted) and their total, the program data
  written, the registers, the screen and its last console lines, and, after **Measure both engines**, the time per step forward
  and back. **VM history against time** charts the history over a run of up to 100,000 steps (5,000,000 at most); the table under it
  lists the naive diary and the reversible engine and labels the tight diary and checkpoint-and-replay *planned* (SPEC 12.4). Leaving
  Compare brings the editor back. **Benchmarks** draws `bench/results.json` (not live): memory held after the run against steps to
  seek to an arbitrary earlier time, log-log, for the naive diary (labelled naive), the tight diary, checkpoint-and-replay at three
  intervals and the reversible program, with a table; Pong and Sort. Pong's conventional twin takes fewer steps per frame, so it
  cannot run in lockstep and the numbers are lined up by frame. A live twin is not built.
- **Examples.** `src/examples.ts`: *add two numbers* reads two typed numbers, prints both and the sum to the console and files them in
  memory (reversible on both engines: an input is read by xor into a zeroed register, a print is an xor into the buffer); *my
  program* is a blank template for your own assembly; *pong* and *pong (rev)* are the games; *hello (rev)* prints, and *fibonacci (rev)*.

## Mounting
```ts
import { mountViz } from '../../viz/src';           // also pulls in the stylesheet
const viz = mountViz(document.getElementById('app')!, vm, { programs, createVm, engines, assemble });
```
`mountViz(root, vm, opts?: { programs?: ProgramEntry[]; initialProgram?: number; createVm?: CreateVm;
engines?: readonly VmKind[]; assemble?: AssembleFn; compile?: AssembleFn; report?: (source, name) => Promise<string> })`, with
`ProgramEntry = { name; blurb?; load(): Uint8Array; source?: string; language?: 'asm' | 'rev'; game?: GameInfo }`
(`load` may throw; the message is shown). `createVm` and `engines` enable the engine switch and Compare. `assemble` enables
**Build and load**; `compile` does the same for rev programs and `report` is their Cost report. `src/main.ts` wires `createWasmVm` (falls back
to the mock), `asm/src/index.ts` and `lang/src/`.

## Slots (empty `div`s the debugger fills; all in `viz.slots`)
| Slot | Where | Notes |
|---|---|---|
| `left` | Under the editor, above the debug bar | The debugger's pane (watches, controls). **While it has children the built-in debug controls hide** (override: `setBuiltinControls`). |
| `toolbar` | Inside the debug bar, after the buttons | Small extras. |
| `timeline` | Above the debug bar | Scrubber. |
| `code` | Replaces the built-in editor | An editor the debugger mounts. |
| `side` | Bottom of the right side | Breakpoint list, watches. |

## Handle: `VizHandle`
```ts
readonly root, vm /* the first machine; a getter, it changes on setEngine */, machines, slots, engines, compare
readonly listing: ListingApi           // the editor's hooks, below
readonly timeline: { onSeek(fn: (t: number) => void): () => void }
readonly program: ProgramInfo | null, snapshot: Snapshot, maxT: number, branch: boolean
on('update' | 'load' | 'run' | 'engine', fn): () => void
refresh(status?), step(), stepBack(), run(mode?), pause(), reset(), loadImage(name, image, source?)
assembleAndLoad(source, name?): AsmOutcome
pushInput(value), setDirection(d), noteHostAction()   // host actions: use these so maxT / branch stay right
setEngine(kind): Promise<Status>, setCompare(on): Promise<Status>
setBuiltinControls('auto' | 'on' | 'off'), destroy()
```
Events: `'update'` `{ t, maxT, branch, direction, snap, prev, status }` after every redraw; `'load'` `ProgramInfo`; `'run'`
`{ mode }`; `'engine'` `{ engine, compare }`. `setEngine` builds a fresh VM, loads the same program, replays recorded inputs and
direction flips at their original `t`, then `runTo(t)`: only host actions made through `viz.pushInput` / `viz.setDirection`
are known. `loadImage` clears the VM's input tape so every run starts with no inputs.

## Editor hooks: `viz.listing: ListingApi`
```ts
onLineClick(fn: (e: { addr: number; gutter: boolean; shiftKey: boolean }) => void): () => void
setBreakpoints(addrs: readonly number[]): void   // a dot in the gutter of exactly these code addresses
setCulprit(addr: number | null): void            // highlights one line (e.g. the instruction that wrote a watched value)
scrollTo(addr: number): void                     // scroll into view; turns "follow" off
followPc: boolean                                // default true
```
The current line is marked automatically. The editor never decides what a click means. **While nobody listens**, a gutter click
toggles a breakpoint and a run stops when the PC reaches one (a fallback); once any `onLineClick` listener exists, the default
stops and the listener owns breakpoints: call `setBreakpoints` yourself.

## Garbage, text and numbers
A data label whose name starts with `garbage` runs to the next data label (or the end of data) and counts as garbage (SPEC section 9):
Compare adds 32 bits for every non-zero word in those regions, and in the console buffer, to `garbage_bits`. Text a program prints
appears in the Output console. Numbers are signed 32-bit decimal everywhere; only instruction words are shown in hex.

## Keyboard encoding
One u32 per event (SPEC 11.7): low byte = key code (ASCII upper-case; Space 0x20, Enter 0x0D, Esc 0x1B, arrows
Up/Down/Left/Right = 0x80/0x81/0x82/0x83), bit 8 (0x100) set = released.

## Files
`src/shell.ts` mount point, machines list, state flow. `src/panels/`: `editor`, `timeline` (the debug bar) and `timebar` (the run-time
bar, its capacity and window), `visualise` with `mainmemory` (Program, Data, Stack), `console`, `game`, `report`, `bench` (the benchmark chart), `screen`/`framebuffer`, `compare`,
`numberinput`, `banners`. `src/datapath/`: `script.ts` (what moves for each instruction), `layout.ts` (geometry and routing),
`diagram.ts` (the SVG and the sphere). `src/track.ts` (forward and back track measurement, garbage bits), `src/runner.ts` (rAF run
loop with the animation gate and breakpoints), `src/icons.ts`, `src/controls.ts`, `src/styles/*`. `scripts/screenshots.mjs` drives the
app through every state at 1280x720 into `screenshots/` (git-ignored; open `screenshots/index.html`). `scripts/pong-check.mjs` plays Pong in a browser with a held key (no scrolling, the paddle moves). `scripts/layout-check.mjs`
(`npm run test:layout`) drags the divider across widths at four window sizes on every tab in a real browser and fails on overlap,
clipping or sideways scroll. Plan and milestones: `UI_PLAN.md`.


## Look
Tokens in `src/styles/tokens.css` (dark only): amber = time moving forward, cyan = time moving back, violet = a new branch. A
change flashes in the colour of the time it moved through. Direction -1 shows a banner and a cyan frame; stepping back never does.
The datapath is ILLUSTRATIVE: the VM exposes no datapath events, so each move is inferred from the decoded instruction and the
registers before and after the step.
