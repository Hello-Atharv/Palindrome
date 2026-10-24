// Extra exports for the WebAssembly build. The C API in spec/vm_api.h is exported as is; these shims exist
// only because JavaScript passes 64-bit values as doubles (exact up to 2^53), not as 64-bit integers.
#include <emscripten/emscripten.h>

#include "vm_api.h"

extern "C" {

EMSCRIPTEN_KEEPALIVE double rvm_wasm_instruction_count(const rvm_t* vm) {
    return static_cast<double>(rvm_instruction_count(vm));
}

EMSCRIPTEN_KEEPALIVE rvm_status rvm_wasm_run_to(rvm_t* vm, double n) {
    return rvm_run_to(vm, n < 0 ? 0 : static_cast<uint64_t>(n));
}

EMSCRIPTEN_KEEPALIVE double rvm_wasm_history_bytes(const rvm_t* vm) {
    return static_cast<double>(rvm_history_bytes(vm));
}

}  // extern "C"
