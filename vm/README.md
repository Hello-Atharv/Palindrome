# vm/
Purpose: the two VMs behind `spec/vm_api.h`, built as the static library `rvm` (C++17, namespace `rev`).
Owner: **core**.

- `include/rvm/`: shared pieces (`isa.h` constants/encoding, `program.h` image parse/serialize, `timeline.h` input tape + direction log).
- `src/logging_vm.*`: the logging VM (oracle). Records per-step deltas; asserts the control-flow rules.
- `src/machine.*`: shared state and non-stepping API (load, tape, direction log, memory reads).
- `src/reversible_vm.*`: the reversible VM. No per-step history; step_back computes the inverse.
- `src/api.cpp`: the C API over both VMs (`RVM_KIND_LOGGING`, `RVM_KIND_REVERSIBLE`).
Add new .cpp files to the `rvm` target in the root `CMakeLists.txt`.
- `wasm/`: Emscripten glue. `npm run build:wasm` writes `web/wasm/lib/rvm_core.js` (see `web/wasm/README.md`).
- `tools/rvm_run.cpp`: run a `.rvm` on either engine (`--engine`, `--rewind`, `--mem`, `--tape`, `--dir -1`).

## WebAssembly build
One-time: install the Emscripten SDK outside the repo (`git clone https://github.com/emscripten-core/emsdk.git ~/emsdk`;
`emsdk install latest`; `emsdk activate latest`, `emsdk.bat` on Windows). Then `npm run build:wasm` at the repo root.
The generated `web/wasm/lib/rvm_core.js` is committed, so UI people never need the SDK.
