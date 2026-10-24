# web/viz/
The visualiser and app shell, laid out like an IDE. Imports `spec/vm_api.ts` only; the VM is injected.
Owner: **viz**. The debugger (`web/debugger/`) mounts into this shell and never edits it.

Toolchain: Vite + TypeScript (strict, vanilla DOM) + Vitest (+ jsdom for the shell tests), 2-space indent.
`npm install`, then `npm run dev` / `npm test` / `npm run build`.

## The screen
```
+--------------------------------------------------------------------------------+
| [sidebar]  Reversible machine                       [Diary|Reversible] [program] |
+----------------------------+---------------------------------------------------+
| editor (source or          |  Visualisation | Output | Compare                   |
| disassembly), gutter with  |                                                    |
| breakpoints, current line  |  the datapath with a travelling sphere, plus a     |
|                            |  fixed 64 data + 16 stack word memory window       |
| ----- debug bar ---------- |                                                    |
| [small icon controls]  t   |  Output: screen, values and text, registers,       |
| tape strip                 |  memory inspector                                  |
| state, history             |  Compare: forward track and back track measured    |
+----------------------------+---------------------------------------------------+
```
The left side (editor + debug bar) collapses completely: the button on the vertical divider or **Ctrl+B**, as in VS Code.
Drag the divider to resize the editor (260 px up to 70% of the width, remembered), double-click it to reset. Assembly is
syntax-coloured (comments, labels, instructions, control flow, registers, numbers, conditions, directives) by `src/highlight.ts`,
drawn behind a transparent textarea. The time line under the controls is a thin track: click or drag it to move through time.
**Send a number** (Visualisation and Output) puts a number on the input tape at the current `t`; `src/examples.ts` has
*add two numbers*, which reads two of them from the input window, adds them and files `first`, `second` and `sum` in memory. It is
reversible: an input is read by xor into a zeroed register, `add` has an inverse, a store is an xor. Send both numbers before
stepping: the input is time-gated, so a number sent after the step that reads it is not seen.
- **Editor.** Assembly source (editable; **Build and load**, or Ctrl+Enter) or, for a program without source, its disassembly.
  Line numbers, a breakpoint gutter, the current instruction highlighted, assembler problems listed under the text.
- **Debug bar.** Small icon buttons (stop, run back, step back, step, run/pause, reverse program, speed), the instruction count
  `t`, a tape strip (ticks, furthest point reached, fork point, discarded future), the state, the history size.
  Alt+`,` step back, Alt+`.` step, Alt+Space run/pause, Alt+0 stop.
- **Visualisation** (simple programs only, at most 30 instructions and 32 data words). One sphere at a time travels along the wire
  the instruction uses, at a constant speed (Slow / Normal / Fast), the wire filling in behind it and the value riding above it.
  A run waits for the animation, so it never outpaces the picture. A step back, or a step while the direction is -1, plays the
  same wires in reverse order in cyan. Bigger programs (sort, cipher, Pong) open in the Output tab instead.
- **Output.** The 64x32 screen (keys go to the machine only while this tab is open), the program's labelled data as numbers and
  text (garbage hatched), the 16 registers and PC, and a memory inspector (data / stack / input window, ASCII column, jump to label).
- **Compare.** *Forward track and back track:* runs the program from t = 0 to its end and back to t = 0 on a fresh copy of each
  engine, repeated until the time is steady, and shows time and history memory per engine with bars. *Live, side by side:* both
  engines on the same program and input at once, with a state-match check and a 256 MiB warning for the diary.

## Mounting
```ts
import { mountViz } from '../../viz/src';           // also pulls in the stylesheet
const viz = mountViz(document.getElementById('app')!, vm, { programs, createVm, engines, assemble });
```
`mountViz(root, vm, opts?: { programs?: ProgramEntry[]; initialProgram?: number; createVm?: CreateVm;
engines?: readonly VmKind[]; assemble?: AssembleFn })`, with `ProgramEntry = { name; blurb?; load(): Uint8Array; source?: string }`
(`load` may throw; the message is shown). `createVm` and `engines` enable the engine switch and Compare. `assemble` enables
**Build and load**. `src/main.ts` wires `createWasmVm` (falls back to the mock) and `asm/src/index.ts`.

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
A data label whose name starts with `garbage` runs to the next data label (or the end of data) and is shown hatched (SPEC
section 9). The Values panel lists every data label as numbers (decimal or hex) and, when most bytes are printable, as text
(cipher.s: `msg`). The machine has no console, so a program's results show up there and on the screen.

## Keyboard encoding
One u32 per event (SPEC 11.7): low byte = key code (ASCII upper-case; Space 0x20, Enter 0x0D, Esc 0x1B, arrows
Up/Down/Left/Right = 0x80/0x81/0x82/0x83), bit 8 (0x100) set = released.

## Files
`src/shell.ts` mount point, machines list, state flow. `src/panels/`: `editor`, `timeline` (the debug bar), `visualise`,
`values`, `registers`, `memory`, `screen`/`framebuffer`, `compare`, `banners`. `src/datapath/`: `script.ts` (what moves for each
instruction), `layout.ts` (geometry and routing), `diagram.ts` (the SVG and the sphere). `src/track.ts` (forward and back track
measurement), `src/runner.ts` (rAF run loop with the animation gate and breakpoints), `src/icons.ts`, `src/controls.ts`,
`src/styles/*`. `scripts/screenshots.mjs` drives the app through every state at 1280x720 into `screenshots/` (git-ignored; open
`screenshots/index.html`). Plan and milestones: `UI_PLAN.md`.

## Look
Tokens in `src/styles/tokens.css` (dark only): amber = time moving forward, cyan = time moving back, violet = a new branch. A
change flashes in the colour of the time it moved through. Direction -1 shows a banner and a cyan frame; stepping back never does.
The datapath is ILLUSTRATIVE: the VM exposes no datapath events, so each move is inferred from the decoded instruction and the
registers before and after the step.
