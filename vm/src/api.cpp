// C API (spec/vm_api.h) over the VM implementations.
#include <exception>
#include <memory>

#include "logging_vm.h"
#include "vm_api.h"

struct rvm {
    rvm_kind kind;
    rev::LoggingVm logging;  // the reversible VM is added alongside when it lands
    std::string error;
};

namespace {

template <typename F>
rvm_status guarded(rvm_t* vm, F&& f) {
    if (vm == nullptr) return RVM_BAD_ARG;
    try {
        return f(vm->logging);
    } catch (const std::exception& e) {
        vm->error = e.what();
        return RVM_FAULT;
    }
}

template <typename F>
rvm_status guarded(const rvm_t* vm, F&& f) {
    if (vm == nullptr) return RVM_BAD_ARG;
    try {
        return f(vm->logging);
    } catch (const std::exception&) {
        return RVM_FAULT;
    }
}

}  // namespace

extern "C" {

const char* rvm_version(void) { return "rvm 0.1.0 (logging VM)"; }

rvm_t* rvm_create(rvm_kind kind) {
    if (kind != RVM_KIND_LOGGING) return nullptr;  // reversible VM not implemented yet
    try {
        std::unique_ptr<rvm_t> vm(new rvm_t);
        vm->kind = kind;
        return vm.release();
    } catch (const std::exception&) {
        return nullptr;
    }
}

void rvm_destroy(rvm_t* vm) { delete vm; }

rvm_status rvm_load_program(rvm_t* vm, const uint8_t* image, size_t len) {
    return guarded(vm, [&](rev::LoggingVm& v) { return v.load(image, len); });
}

rvm_status rvm_set_input_tape(rvm_t* vm, const uint8_t* tape, size_t len) {
    return guarded(vm, [&](rev::LoggingVm& v) { return v.set_input_tape(tape, len); });
}

rvm_status rvm_push_input(rvm_t* vm, uint32_t value) {
    return guarded(vm, [&](rev::LoggingVm& v) { return v.push_input(value); });
}

rvm_status rvm_step_forward(rvm_t* vm) {
    return guarded(vm, [](rev::LoggingVm& v) { return v.step_forward(); });
}

rvm_status rvm_step_back(rvm_t* vm) {
    return guarded(vm, [](rev::LoggingVm& v) { return v.step_back(); });
}

rvm_status rvm_run_to(rvm_t* vm, uint64_t n) {
    return guarded(vm, [&](rev::LoggingVm& v) { return v.run_to(n); });
}

rvm_status rvm_get_registers(const rvm_t* vm, uint32_t out_regs[16], uint32_t* out_pc) {
    if (out_regs == nullptr) return RVM_BAD_ARG;
    return guarded(vm, [&](const rev::LoggingVm& v) { return v.get_registers(out_regs, out_pc); });
}

rvm_status rvm_get_memory(const rvm_t* vm, uint32_t addr, uint32_t nwords, uint32_t* out) {
    if (out == nullptr && nwords != 0) return RVM_BAD_ARG;
    return guarded(vm, [&](const rev::LoggingVm& v) { return v.get_memory(addr, nwords, out); });
}

rvm_status rvm_get_code(const rvm_t* vm, uint32_t addr, uint32_t nwords, uint32_t* out) {
    if (out == nullptr && nwords != 0) return RVM_BAD_ARG;
    return guarded(vm, [&](const rev::LoggingVm& v) { return v.get_code(addr, nwords, out); });
}

int rvm_get_direction(const rvm_t* vm) { return vm == nullptr ? 1 : vm->logging.direction(); }

rvm_status rvm_set_direction(rvm_t* vm, int dir) {
    return guarded(vm, [&](rev::LoggingVm& v) { return v.set_direction(dir); });
}

uint64_t rvm_instruction_count(const rvm_t* vm) {
    return vm == nullptr ? 0 : vm->logging.instruction_count();
}

size_t rvm_history_bytes(const rvm_t* vm) { return vm == nullptr ? 0 : vm->logging.history_bytes(); }

const char* rvm_last_error(const rvm_t* vm) {
    if (vm == nullptr) return "null vm";
    return vm->error.empty() ? vm->logging.last_error() : vm->error.c_str();
}

}  // extern "C"
