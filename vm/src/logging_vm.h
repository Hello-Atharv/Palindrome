// The logging VM: the correctness oracle. Executes with ordinary semantics and records, for every
// step, the old value of everything it changed; step_back restores those. It also asserts the
// control-flow rules of spec/SPEC.md section 6 (which the reversible VM can only trust).
#pragma once

#include <vector>

#include "machine.h"

namespace rev {

class LoggingVm : public Machine {
public:
    rvm_status step_forward() override;
    rvm_status step_back() override;
    size_t history_bytes() const override { return deltas_.size() * sizeof(Delta) + dirlog_.bytes(); }

protected:
    void reset_extra() override {
        prev_ = Prev{};
        deltas_.clear();
    }

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

    void set_reg(uint32_t r, uint32_t v);
    void set_mem(uint32_t addr, uint32_t v);
    void undo(const Delta& d);

    rvm_status apply_data(const Instr& i, bool inverse);
    rvm_status exec_forward();  // one step of the program run forward (d = +1)
    rvm_status exec_inverse();  // one step of the program run as its own inverse (d = -1)

    Prev prev_;
    std::vector<Delta> deltas_;
    Delta* cur_ = nullptr;
};

}  // namespace rev
