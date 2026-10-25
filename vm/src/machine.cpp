#include "machine.h"

namespace rev {

rvm_status Machine::fault(const std::string& msg) const {
    err_ = msg;
    return RVM_FAULT;
}

uint32_t Machine::rotl(uint32_t v, uint32_t k) {
    k &= 31;
    return k == 0 ? v : (v << k) | (v >> (32 - k));
}

bool Machine::read_word(uint32_t addr, uint64_t t, uint32_t* out) const {
    if (addr < kRamWords) {
        *out = ram_[addr];
        return true;
    }
    if (addr >= kInBase && addr < kInEnd) {
        const uint32_t off = addr - kInBase;
        const uint32_t count = tape_.count_at(t);
        if (off == 0) *out = static_cast<uint32_t>(t);
        else if (off == 1) *out = count;
        else if (off == kInLatestOff) *out = count ? tape_.value(count - 1) : 0;
        else *out = (off - 2 < count) ? tape_.value(off - 2) : 0;
        return true;
    }
    return false;
}

bool Machine::cond(const Instr& i) const {
    const uint32_t a = regs_[i.ra], b = regs_[i.rb];
    switch (i.cc) {
        case kAl: return true;
        case kEq: return a == b;
        case kNe: return a != b;
        default: return static_cast<int32_t>(a) < static_cast<int32_t>(b);
    }
}

rvm_status Machine::load(const uint8_t* image, size_t len) {
    Program p;
    std::string e;
    if (!parse_program(image, len, p, e)) {
        err_ = e;
        return RVM_BAD_PROGRAM;
    }
    prog_ = std::move(p);
    ram_.assign(kRamWords, 0);
    std::copy(prog_.data.begin(), prog_.data.end(), ram_.begin());
    for (uint32_t& r : regs_) r = 0;
    regs_[kSpReg] = kStackBase;
    pc_ = prog_.entry;
    t_ = 0;
    dirlog_.clear();  // the input tape deliberately survives a reload
    reset_extra();
    loaded_ = true;
    return RVM_OK;
}

rvm_status Machine::set_input_tape(const uint8_t* tape, size_t len) {
    std::string e;
    if (!tape_.parse(tape, len, e)) {
        err_ = e;
        return RVM_BAD_ARG;
    }
    return RVM_OK;
}

rvm_status Machine::push_input(uint32_t value) {
    tape_.push(t_, value);
    dirlog_.drop_after(t_);  // a host action starts a new branch
    return RVM_OK;
}

rvm_status Machine::set_direction(int dir) {
    if (dir != 1 && dir != -1) {
        err_ = "direction must be +1 or -1";
        return RVM_BAD_ARG;
    }
    tape_.drop_after(t_);  // a host action starts a new branch
    dirlog_.set(t_, dir);
    return RVM_OK;
}

rvm_status Machine::run_to(uint64_t n) {
    while (t_ < n) {
        const rvm_status s = step_forward();
        if (s != RVM_OK) return s;
    }
    while (t_ > n) {
        const rvm_status s = step_back();
        if (s != RVM_OK) return s;  // never spin if an undo fails
    }
    return RVM_OK;
}

rvm_status Machine::get_registers(uint32_t* regs, uint32_t* pc) const {
    for (uint32_t i = 0; i < kNumRegs; ++i) regs[i] = regs_[i];
    if (pc != nullptr) *pc = pc_;
    return RVM_OK;
}

rvm_status Machine::get_memory(uint32_t addr, uint32_t nwords, uint32_t* out) const {
    for (uint32_t i = 0; i < nwords; ++i) {
        if (!read_word(addr + i, t_, &out[i]) || addr + i < addr) {
            err_ = "address not mapped";
            return RVM_BAD_ARG;
        }
    }
    return RVM_OK;
}

rvm_status Machine::get_code(uint32_t addr, uint32_t nwords, uint32_t* out) const {
    if (static_cast<uint64_t>(addr) + nwords > prog_.code.size()) {
        err_ = "code range out of bounds";
        return RVM_BAD_ARG;
    }
    for (uint32_t i = 0; i < nwords; ++i) out[i] = prog_.code[addr + i];
    return RVM_OK;
}

}  // namespace rev
