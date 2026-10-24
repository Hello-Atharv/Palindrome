// Common machine state and the non-stepping parts of the VM API, shared by the logging VM and the
// reversible VM. Each subclass implements only how it steps forward and back (and its history).
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "rvm/isa.h"
#include "rvm/program.h"
#include "rvm/timeline.h"
#include "vm_api.h"

namespace rev {

// What the C API (api.cpp) drives.
class Vm {
public:
    virtual ~Vm() = default;
    virtual rvm_status load(const uint8_t* image, size_t len) = 0;
    virtual rvm_status set_input_tape(const uint8_t* tape, size_t len) = 0;
    virtual rvm_status push_input(uint32_t value) = 0;
    virtual rvm_status step_forward() = 0;
    virtual rvm_status step_back() = 0;
    virtual rvm_status run_to(uint64_t n) = 0;
    virtual rvm_status get_registers(uint32_t* regs, uint32_t* pc) const = 0;
    virtual rvm_status get_memory(uint32_t addr, uint32_t nwords, uint32_t* out) const = 0;
    virtual rvm_status get_code(uint32_t addr, uint32_t nwords, uint32_t* out) const = 0;
    virtual int direction() const = 0;
    virtual rvm_status set_direction(int dir) = 0;
    virtual uint64_t instruction_count() const = 0;
    virtual size_t history_bytes() const = 0;
    virtual const char* last_error() const = 0;
};

class Machine : public Vm {
public:
    rvm_status load(const uint8_t* image, size_t len) override;
    rvm_status set_input_tape(const uint8_t* tape, size_t len) override;
    rvm_status push_input(uint32_t value) override;
    rvm_status run_to(uint64_t n) override;
    rvm_status get_registers(uint32_t* regs, uint32_t* pc) const override;
    rvm_status get_memory(uint32_t addr, uint32_t nwords, uint32_t* out) const override;
    rvm_status get_code(uint32_t addr, uint32_t nwords, uint32_t* out) const override;
    int direction() const override { return dirlog_.at(t_); }
    rvm_status set_direction(int dir) override;
    uint64_t instruction_count() const override { return t_; }
    const char* last_error() const override { return err_.c_str(); }

protected:
    virtual void reset_extra() {}  // subclass state to clear on load

    rvm_status fault(const std::string& msg) const;
    // Data-space read as seen by a step that starts at time t (the input window depends on t).
    bool read_word(uint32_t addr, uint64_t t, uint32_t* out) const;
    bool cond(const Instr& i) const;
    static uint32_t rotl(uint32_t v, uint32_t k);

    bool loaded_ = false;
    Program prog_;
    uint32_t regs_[kNumRegs] = {};
    uint32_t pc_ = 0;
    std::vector<uint32_t> ram_;
    uint64_t t_ = 0;
    InputTape tape_;
    DirLog dirlog_;
    mutable std::string err_;
};

}  // namespace rev
