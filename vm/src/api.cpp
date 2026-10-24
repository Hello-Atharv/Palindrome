// C API (spec/vm_api.h) over the VM implementations.
#include <exception>
#include <memory>
#include <string>

#include "logging_vm.h"
#include "reversible_vm.h"
#include "vm_api.h"

struct rvm {
    rvm_kind kind;
    std::unique_ptr<rev::Vm> vm;
    std::string error;
};

namespace {

template <typename F>
rvm_status guarded(rvm_t* h, F&& f) {
    if (h == nullptr) return RVM_BAD_ARG;
    try {
        return f(*h->vm);
    } catch (const std::exception& e) {
        h->error = e.what();
        return RVM_FAULT;
    }
}

template <typename F>
rvm_status guarded(const rvm_t* h, F&& f) {
    if (h == nullptr) return RVM_BAD_ARG;
    try {
        return f(*h->vm);
    } catch (const std::exception&) {
        return RVM_FAULT;
    }
}

}  // namespace

extern "C" {

const char* rvm_version(void) { return "rvm 0.2.0 (logging + reversible VM)"; }

rvm_t* rvm_create(rvm_kind kind) {
    try {
        std::unique_ptr<rvm_t> h(new rvm_t);
        h->kind = kind;
        if (kind == RVM_KIND_LOGGING) h->vm.reset(new rev::LoggingVm);
        else if (kind == RVM_KIND_REVERSIBLE) h->vm.reset(new rev::ReversibleVm);
        else return nullptr;
        return h.release();
    } catch (const std::exception&) {
        return nullptr;
    }
}

void rvm_destroy(rvm_t* h) { delete h; }

rvm_status rvm_load_program(rvm_t* h, const uint8_t* image, size_t len) {
    return guarded(h, [&](rev::Vm& v) { return v.load(image, len); });
}

rvm_status rvm_set_input_tape(rvm_t* h, const uint8_t* tape, size_t len) {
    return guarded(h, [&](rev::Vm& v) { return v.set_input_tape(tape, len); });
}

rvm_status rvm_push_input(rvm_t* h, uint32_t value) {
    return guarded(h, [&](rev::Vm& v) { return v.push_input(value); });
}

rvm_status rvm_step_forward(rvm_t* h) {
    return guarded(h, [](rev::Vm& v) { return v.step_forward(); });
}

rvm_status rvm_step_back(rvm_t* h) {
    return guarded(h, [](rev::Vm& v) { return v.step_back(); });
}

rvm_status rvm_run_to(rvm_t* h, uint64_t n) {
    return guarded(h, [&](rev::Vm& v) { return v.run_to(n); });
}

rvm_status rvm_get_registers(const rvm_t* h, uint32_t out_regs[16], uint32_t* out_pc) {
    if (out_regs == nullptr) return RVM_BAD_ARG;
    return guarded(h, [&](const rev::Vm& v) { return v.get_registers(out_regs, out_pc); });
}

rvm_status rvm_get_memory(const rvm_t* h, uint32_t addr, uint32_t nwords, uint32_t* out) {
    if (out == nullptr && nwords != 0) return RVM_BAD_ARG;
    return guarded(h, [&](const rev::Vm& v) { return v.get_memory(addr, nwords, out); });
}

rvm_status rvm_get_code(const rvm_t* h, uint32_t addr, uint32_t nwords, uint32_t* out) {
    if (out == nullptr && nwords != 0) return RVM_BAD_ARG;
    return guarded(h, [&](const rev::Vm& v) { return v.get_code(addr, nwords, out); });
}

int rvm_get_direction(const rvm_t* h) { return h == nullptr ? 1 : h->vm->direction(); }

rvm_status rvm_set_direction(rvm_t* h, int dir) {
    return guarded(h, [&](rev::Vm& v) { return v.set_direction(dir); });
}

uint64_t rvm_instruction_count(const rvm_t* h) { return h == nullptr ? 0 : h->vm->instruction_count(); }

size_t rvm_history_bytes(const rvm_t* h) { return h == nullptr ? 0 : h->vm->history_bytes(); }

const char* rvm_last_error(const rvm_t* h) {
    if (h == nullptr) return "null vm";
    return h->error.empty() ? h->vm->last_error() : h->error.c_str();
}

}  // extern "C"
