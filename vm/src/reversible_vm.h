// The reversible VM. Keeps no per-step history: step_back computes the inverse of the last step from the
// current state alone (spec/SPEC.md section 6, backward()). Its only history is the direction log.
// It trusts LND assertions (it cannot check them without history); everything else the logging VM
// checks is a function of (state, code), so it checks that too and faults identically.
#pragma once

#include "machine.h"

namespace rev {

class ReversibleVm : public Machine {
public:
    rvm_status step_forward() override;
    rvm_status step_back() override;
    size_t history_bytes() const override { return dirlog_.bytes(); }

private:
    // `now` is the machine time at which the step being executed (or undone) began; the input window
    // is read as of `now`. Each function validates before writing, so a fault leaves state unchanged.
    rvm_status exec_forward(uint64_t now);
    rvm_status exec_inverse(uint64_t now);
    rvm_status apply_data(const Instr& i, bool inverse, uint64_t now);
};

}  // namespace rev
