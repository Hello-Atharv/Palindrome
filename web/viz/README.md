# web/viz/
Purpose: visualiser and app shell: registers, PC + disassembly, memory (data / stack / input window), 64x32 framebuffer,
t / direction / history readout, keyboard capture (keys -> `pushInput`). Imports `spec/vm_api.ts` only; the VM is injected.
Owner: **viz**.

Toolchain: Vite + TypeScript (strict, vanilla DOM) + Vitest, 2-space indent. `npm install`, then `npm run dev` / `npm test`.

## Mounting (for web/debugger)
```ts
import { mountViz } from '../../viz/src';
const viz = mountViz(document.getElementById('app')!, vm, { programs });
viz.slots.timeline.append(scrubber);   // full-width strip under the toolbar
viz.slots.toolbar.append(controls);    // right of the transport buttons
viz.slots.side.append(breakpoints);    // bottom of the right column
viz.on('update', ({ snap, prev }) => {});  // after every redraw
vm.runTo(500); viz.refresh();          // after driving the VM yourself
```
Events: `update`, `load`, `run`. Methods: `step`, `stepBack`, `run(mode)`, `pause`, `reset`, `loadImage`, `refresh`, `destroy`.

## Keyboard encoding
One u32 per event: low byte = key code (ASCII upper-case; Space 0x20, Enter 0x0D, Esc 0x1B, arrows Up/Down/Left/Right =
0x80/0x81/0x82/0x83), bit 8 (0x100) set = key released.

## Layout
`src/shell.ts` mount point and state flow; `src/panels/*` one file per panel; `src/runner.ts` rAF run loop (many steps per
frame, one redraw); `src/disasm.ts`, `src/snapshot.ts`, `src/keys.ts`, `src/program.ts` pure helpers (unit-tested).
`src/main.ts` is the dev entry and the only file that imports the mock VM.
