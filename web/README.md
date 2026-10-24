# web/
Purpose: web UI for the reversible machine. Written in TypeScript against `spec/vm_api.ts` (interface `RVM`); 2-space indent.

- `viz/` visualiser and app shell. Owner: **viz**.
- `debugger/` scrubber timeline, step back, breakpoints. Owner: **debugger**.
- `mock_vm/` fake VM implementing `RVM` so UI work is not blocked. Owner: **viz**.

Contract: never import anything VM-specific except `spec/vm_api.ts`. When the real VM arrives as WASM,
only the factory (`CreateVm`) changes. Pick the toolchain (Vite + TypeScript is a good default) in
`web/viz` and record the choice in your status file so the debugger person matches it.
