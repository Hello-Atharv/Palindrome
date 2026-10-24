# web/viz/
Visualiser and app shell: registers, listing with breakpoint gutter, memory (data / stack / input window), 64x32 screen,
time readouts, keyboard capture (keys -> `pushInput`). Imports `spec/vm_api.ts` only; the VM is injected.
Owner: **viz**. The debugger (`web/debugger/`) mounts into this shell and never edits it.

Toolchain: Vite + TypeScript (strict, vanilla DOM) + Vitest (+ jsdom for the shell tests), 2-space indent.
`npm install`, then `npm run dev` / `npm test` / `npm run build`.

## Mounting
```ts
import { mountViz } from '../../viz/src';           // also pulls in the stylesheet
const viz = mountViz(document.getElementById('app')!, vm, { programs });
```
`mountViz(root: HTMLElement, vm: RVM, opts?: { programs?: ProgramEntry[]; initialProgram?: number }): VizHandle`
with `ProgramEntry = { name: string; blurb?: string; load: () => Uint8Array }` (a `.rvm` image).

## Slots (empty `div`s the debugger fills; all in `viz.slots`)
| Slot | Where | Notes |
|---|---|---|
| `left` | Left column of the Debug view | The debugger's pane (editor, controls, watches). **While it has children the built-in step/run controls hide** (override: `setBuiltinControls`). |
| `toolbar` | Right of the transport buttons | Small extras. |
| `timeline` | Full-width strip under the toolbar | Scrubber. |
| `side` | Bottom of the right column | Breakpoint list, watches. |
| `code` | Body of the Code view | Editor. |

## Handle: `VizHandle`
```ts
readonly root: HTMLElement
readonly vm: RVM                       // primary machine (machines[0])
readonly machines: readonly { label: string; vm: RVM }[]   // every action below is applied to all of them
readonly slots: VizSlots
readonly listing: ListingApi           // see below
readonly program: ProgramInfo | null   // { name, image, codeLen, entry, labels: Map<addr, name> }
readonly snapshot: Snapshot            // latest: { t, pc, regs, direction, historyBytes, lastError, status, fb }
readonly maxT: number                  // largest t reached on the current branch
readonly branch: boolean               // a host action discarded part of the timeline since the last load
on('update' | 'load' | 'run', fn): () => void   // returns unsubscribe
refresh(status?: Status): void         // re-read the machines and redraw (call after you drive the vm yourself)
step(): Status;  stepBack(): Status;  run(mode?: 'forward' | 'back'): void;  pause(): void;  reset(): Status
loadImage(name: string, image: Uint8Array): Status
pushInput(value: number): Status       // host action: all machines, resets maxT, may set `branch`
setDirection(d: 1 | -1): Status        // host action, same
noteHostAction(): void                 // call if you did a host action on a vm yourself
setBuiltinControls('auto' | 'on' | 'off'): void
destroy(): void
```
Use `viz.pushInput` / `viz.setDirection` rather than the vm's methods so `maxT` and `branch` stay right.

### Events
```ts
'update': { t: number; maxT: number; branch: boolean; direction: 1 | -1;
            snap: Snapshot; prev: Snapshot | null; status: Status }   // after every redraw
'load':   ProgramInfo                                                  // program loaded, t = 0
'run':    { mode: 'forward' | 'back' | null }                          // null = paused/stopped
```
`prev` is the snapshot before the most recent change of `t`. `branch` becomes true when a host action happens while
`t < maxT` (the future is discarded) and clears on load/reset.

## Listing hooks: `viz.listing: ListingApi`
```ts
onLineClick(fn: (e: { addr: number; gutter: boolean; shiftKey: boolean }) => void): () => void
setBreakpoints(addrs: readonly number[]): void   // draws a dot in the gutter of exactly these code addresses
setCulprit(addr: number | null): void            // highlights one line (e.g. the instruction that wrote a watched value)
scrollTo(addr: number): void                     // scroll into view; turns "follow pc" off
followPc: boolean                                // default true
```
The PC line is marked automatically. The listing never decides what a click means: toggle breakpoints yourself in
`onLineClick` (`e.gutter` tells you whether the dot area was hit) and call `setBreakpoints`.

## Keyboard encoding
One u32 per event (SPEC 11.7): low byte = key code (ASCII upper-case; Space 0x20, Enter 0x0D, Esc 0x1B, arrows
Up/Down/Left/Right = 0x80/0x81/0x82/0x83), bit 8 (0x100) set = released. Keys reach the machine only while the Debug view
and its **Screen** tab are open, and the "send keys" box is ticked.

## Layout
`src/shell.ts` mount point, machines list and state flow; `src/panels/*` one file per panel (`listing.ts` is the virtualised
disassembly); `src/tabs.ts`; `src/runner.ts` rAF run loop (many steps per frame, one redraw); `src/disasm.ts`,
`src/snapshot.ts`, `src/keys.ts`, `src/program.ts` pure helpers. `src/main.ts` is the dev entry and the only file that
imports the mock VM. Plan and milestones: `UI_PLAN.md`.

## Timeline hero (bottom bar)
Big `t`, a state chip (running forward / running back / paused / halted / at start / fault), the transport, and a tape strip
with ticks every 1-2-5 steps, a `maxT` marker, the branch point and the discarded future. Dragging the strip calls
`viz.timeline.onSeek(fn: (t: number) => void)` listeners; **with none registered the shell falls back to a plain throttled
`runTo`** (no chunking or progress: that is the debugger's job, so register a listener and move the machines yourself, then
call `viz.refresh()`). `viz.slots.toolbar` sits inside the hero, left of the transport; `viz.slots.timeline` is a strip above it.

## Look and states
Tokens are in `src/styles/tokens.css` (dark only): amber = time moving forward, cyan = time moving back, violet = new branch.
A change flashes in the colour of the time it moved through; above 20 steps/s the page switches to a heat map. Direction -1
shows a full-width banner and a tinted frame; stepping back never does. Alt+`,` step back, Alt+`.` step, Alt+Space run/pause,
Alt+0 stop (Alt combinations never reach the machine).
`node scripts/screenshots.mjs` drives the real mock VM through every state at 1280x720 into `screenshots/` (git-ignored;
open `screenshots/index.html`) and reports if the page scrolls.

## Real engines, Compare, assembler (added after the WASM merge)
`mountViz(root, vm, opts)` now also takes:
```ts
createVm?: CreateVm                 // makes a VM of a kind; enables the engine switch and Compare
engines?: readonly VmKind[]         // kinds createVm can make (default: just vm.kind)
assemble?: (source: string, fileName?: string) => AsmOutcome   // enables the Code view's built-in editor
```
`ProgramEntry` gained `source?: string` (shown/edited in the Code view) and its `load()` may throw: the message is shown.
`src/main.ts` wires `createWasmVm` (falls back to the mock if WebAssembly is unavailable) and `asm/src/index.ts`.

New on `VizHandle`: `engines`, `compare`, `setEngine(kind)`, `setCompare(on)`, `assembleAndLoad(source, name?)`, and
`loadImage(name, image, source?)`; new event `'engine'` (`{ engine, compare }`). **`viz.vm` is a getter: it is a different
object after `setEngine`, so do not cache it; re-read it on `'engine'`.**
- `setEngine`: builds a fresh VM of the other kind, loads the same program, replays the recorded inputs and direction flips
  at their original `t`, then `runTo(t)`. Only host actions made through `viz.pushInput` / `viz.setDirection` are known;
  anything done on a vm directly is lost on a switch.
- `setCompare(true)`: adds the other engine to `viz.machines`; every action goes to both. The Compare tab shows a state-match
  badge (registers, PC, screen every refresh; the whole 0x20800-word writable memory 4 times a second), history bytes and
  non-zero words per side, and a 256 MiB warning for the diary. On a difference the run pauses.
- `loadImage` clears the VM's input tape (`setInputTape` with an empty tape) so each run starts with no inputs.

**Garbage convention** (SPEC section 9, "Sort garbage"): a data label whose name starts with `garbage` runs to the next data
label or the end of data; those words are hatched in the Memory view (sort.s: addresses 8-26). The Memory view also has an
ASCII column (4 bytes per word, little-endian) and a jump-to-data-label menu (cipher.s: `msg` at 0x1b).
