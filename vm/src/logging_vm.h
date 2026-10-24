// The logging VM: the correctness oracle. Executes with ordinary semantics and records, for every
// step, the old value of everything it changed; step_back restores those. It also asserts the
// control-flow rules of spec/SPEC.md section 6 (which the reversible VM can only trust).
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

class LoggingVm {
public:
    rvm_status load(const uint8_t* image, size_t len);
    rvm_status set_input_tape(const uint8_t* tape, size_t len);
    rvm_status push_input(uint32_t value);

    rvm_status step_forward();
    rvm_status step_back();
    rvm_status run_to(uint64_t n);

    rvm_status get_registers(uint32_t* regs, uint32_t* pc) const;
    rvm_status get_memory(uint32_t addr, uint32_t nwords, uint32_t* out) const;
    rvm_status get_code(uint32_t addr, uint32_t nwords, uint32_t* out) const;

    int direction() const { return dirlog_.at(t_); }
    rvm_status set_direction(int dir);

    uint64_t instruction_count() const { return t_; }
    size_t history_bytes() const { return deltas_.size() * sizeof(Delta) + dirlog_.bytes(); }
    const char* last_error() const { return err_.c_str(); }

private:
    // How the previous d=+1 step arrived at pc_; lets us check LND assertions.
    struct Prev {
        bool valid = false;
        bool jumped = false;  // previous step was a taken BR
        uint32_t pc = 0;      // address of the previous instruction
    };
    struct Change {
        uint32_t loc;  // register index, or address | kMemFlag
        uint32_t old;
    };
    struct Delta {
        uint32_t pc_before = 0;
        Prev prev_before;
        uint32_t n = 0;
        Change ch[4] = {};
    };
    static constexpr uint32_t kMemFlag = 0x80000000u;

    rvm_status fault(const std::string& msg) const;
    bool read_word(uint32_t addr, uint32_t* out) const;
    bool cond(const Instr& i) const;
    void set_reg(uint32_t r, uint32_t v);
    void set_mem(uint32_t addr, uint32_t v);
    void undo(const Delta& d);

    rvm_status apply_data(const Instr& i, bool inverse);
    rvm_status exec_forward();  // one step of the program run forward (d = +1)
    rvm_status exec_inverse();  // one step of the program run as its own inverse (d = -1)

    bool loaded_ = false;
    Program prog_;
    uint32_t regs_[kNumRegs] = {};
    uint32_t pc_ = 0;
    std::vector<uint32_t> ram_;
    uint64_t t_ = 0;
    Prev prev_;
    std::vector<Delta> deltas_;
    Delta* cur_ = nullptr;
    InputTape tape_;
    DirLog dirlog_;
    mutable std::string err_;
};

}  // namespace rev
