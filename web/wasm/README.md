# web/wasm/
Purpose: the real C++ VMs (logging and reversible) compiled to WebAssembly, behind the `RVM` interface in
`spec/vm_api.ts`. A drop-in replacement for `web/mock_vm`. Owner: **core**.

```ts
import { createWasmVm } from '../../wasm/src/index.js';
const vm = await createWasmVm('reversible');   // or 'logging'
vm.loadProgram(image);                          // image from asm/ (assemble().image)
vm.stepForward(); vm.stepBack(); vm.runTo(0);
```
- `lib/rvm_core.js` is the Emscripten output (generated; single file with the wasm embedded, so Vite, Node and web
  workers can all load it with no extra fetches). **It is committed**, so UI people do not need the SDK.
- `src/index.ts` wraps it as `WasmVm implements RVM`. Extra: `destroy()` to free a VM. All VMs share one wasm instance.
- Differences from the mock: `kind: 'reversible'` really has no history (`historyBytes` is 0 per step); `memory()` reads
  unmapped addresses as 0 like the mock does; `code()` throws `RangeError` past the program.
- Long `runTo()` calls block the page: call them in chunks (SPEC 11.8) or from a web worker.

## Rebuilding (only if vm/ changes)
One-time: install the Emscripten SDK outside the repo (`git clone https://github.com/emscripten-core/emsdk.git ~/emsdk`,
then `emsdk install latest` and `emsdk activate latest`; `emsdk.bat` on Windows). Then from the repo root:
`npm run build:wasm`. Commit the regenerated `lib/rvm_core.js`.

Tests: `cd web/wasm && npm install && npm test` (runs the assembler's examples on both engines, a random-scrub
differential test between them, and a long rewind).

## Playground (see the real engines run)
`cd web/wasm && npm install && npm run playground` opens a small page at http://localhost:5173. It is not the product UI
(that is `web/viz`); it is a working reference for `createWasmVm` and `assemble()` in a Vite page, and a way to watch a program.
- The demo programs (cipher, sort, **Pong**, examples), each with a one-line explanation of what to look at. **The keyboard is wired
  to the machine** (W/S/arrows etc., encoded as in SPEC 11.7), so Pong can be played: pick it, press Run, use W/S or the arrows.
- **Compare engines**: the diary engine and the reversible engine side by side on the same program, driven by the same actions.
  Shows each engine's VM history as a big number, both screens and registers, a "states match" badge (registers, PC, memory and
  screen compared after every action), and a chart of history against time: the diary climbs, the reversible line stays at zero.
- Step, step back, run, run back, a time scrubber, the direction toggle with a "running in reverse" banner, changed values
  flashing amber (forward) or cyan (backward), a code listing with the PC marked, a memory window (jump to data / stack / screen,
  ASCII column), and a zoom for the small screen.
- URL options: `?p=<program index>&e=reversible|logging&cmp=1&t=<steps to run>&mem=<memory start>&dir=-1&after=<steps in reverse>`.
  Examples: `?p=0&t=800` the cipher part-way through; `?p=1&cmp=1&t=200` the sort on both engines; `?p=0&t=1203&dir=-1&after=600`
  the cipher decrypting.
