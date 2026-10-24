# vm/
Purpose: the two VMs behind `spec/vm_api.h`, built as the static library `rvm` (C++17, namespace `rev`).
Owner: **core**.

- `include/rvm/`: shared pieces (`isa.h` constants/encoding, `program.h` image parse/serialize, `timeline.h` input tape + direction log).
- `src/logging_vm.*`: the logging VM (oracle). Records per-step deltas; asserts the control-flow rules.
- `src/api.cpp`: the C API. `RVM_KIND_REVERSIBLE` is not implemented yet (create returns NULL).
Add new .cpp files to the `rvm` target in the root `CMakeLists.txt`.
