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
