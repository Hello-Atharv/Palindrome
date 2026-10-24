#include "logging_vm.h"

namespace rev {

// ---- change log ---------------------------------------------------------------------------

void LoggingVm::set_reg(uint32_t r, uint32_t v) {
    cur_->ch[cur_->n++] = {r, regs_[r]};
    regs_[r] = v;
}

void LoggingVm::set_mem(uint32_t addr, uint32_t v) {
    cur_->ch[cur_->n++] = {addr | kMemFlag, ram_[addr]};
    ram_[addr] = v;
}

void LoggingVm::undo(const Delta& d) {
    for (uint32_t k = d.n; k-- > 0;) {
        const Change& c = d.ch[k];
        if (c.loc & kMemFlag) ram_[c.loc & ~kMemFlag] = c.old;
        else regs_[c.loc] = c.old;
    }
    pc_ = d.pc_before;
    prev_ = d.prev_before;
}

// ---- stepping -----------------------------------------------------------------------------

rvm_status LoggingVm::step_forward() {
    if (!loaded_) {
        err_ = "no program loaded";
        return RVM_BAD_ARG;
    }
    Delta d;
    d.pc_before = pc_;
    d.prev_before = prev_;
    cur_ = &d;
    const rvm_status s = dirlog_.at(t_) > 0 ? exec_forward() : exec_inverse();
    cur_ = nullptr;
    if (s == RVM_OK) {
        deltas_.push_back(d);
        ++t_;
    } else {
        undo(d);  // a fault or halt leaves state exactly as it was
    }
    return s;
}

rvm_status LoggingVm::step_back() {
    if (!loaded_) {
        err_ = "no program loaded";
        return RVM_BAD_ARG;
    }
    if (t_ == 0) return RVM_AT_START;
    undo(deltas_.back());
    deltas_.pop_back();
    --t_;
    return RVM_OK;
}

// ---- instruction semantics ----------------------------------------------------------------

// Data instructions (ADD..TOFF). `inverse` applies the Inverse column of SPEC section 4.
rvm_status LoggingVm::apply_data(const Instr& i, bool inverse) {
    const uint32_t a = i.ra, b = i.rb, c = i.rc;
    switch (i.op) {
        case Op::ADD:
        case Op::SUB: {
            if (a == b) return fault("ADD/SUB operands must differ");
            const bool add = (i.op == Op::ADD) != inverse;
            set_reg(a, add ? regs_[a] + regs_[b] : regs_[a] - regs_[b]);
            break;
        }
        case Op::ADDI:
            set_reg(a, inverse ? regs_[a] - i.simm : regs_[a] + i.simm);
            break;
        case Op::XOR:
            if (a == b) return fault("XOR operands must differ");
            set_reg(a, regs_[a] ^ regs_[b]);
            break;
        case Op::XORI:
            set_reg(a, regs_[a] ^ i.imm18);
            break;
        case Op::NOT:
            set_reg(a, ~regs_[a]);
            break;
        case Op::SWAP:
            if (a != b) {
                const uint32_t va = regs_[a], vb = regs_[b];
                set_reg(a, vb);
                set_reg(b, va);
            }
            break;
        case Op::ROLI: {
            const uint32_t k = i.imm18 & 31;
            set_reg(a, rotl(regs_[a], inverse ? (32 - k) & 31 : k));
            break;
        }
        case Op::XLD: {
            if (a == b) return fault("XLD operands must differ");
            uint32_t w;
            if (!read_word(regs_[b] + i.simm, t_, &w)) return fault("XLD from unmapped address");
            set_reg(a, regs_[a] ^ w);
            break;
        }
        case Op::XST: {
            const uint32_t addr = regs_[b] + i.simm;
            if (addr >= kRamWords) return fault("XST to non-writable address");
            set_mem(addr, ram_[addr] ^ regs_[a]);
            break;
        }
        case Op::CSWAP:
            if (c == a || c == b) return fault("CSWAP control register must differ from operands");
            if (regs_[c] != 0 && a != b) {
                const uint32_t va = regs_[a], vb = regs_[b];
                set_reg(a, vb);
                set_reg(b, va);
            }
            break;
        case Op::TOFF:
            if (a == b || a == c) return fault("TOFF target must differ from controls");
            set_reg(a, regs_[a] ^ (regs_[b] & regs_[c]));
            break;
        default:
            return fault("internal: not a data instruction");
    }
    return RVM_OK;
}

rvm_status LoggingVm::exec_forward() {
    const size_t size = prog_.code.size();
    if (pc_ >= size) return fault("PC outside code");
    const Instr i = decode(prog_.code[pc_]);
    const uint32_t here = pc_;
    bool jumped = false;

    switch (i.op) {
        case Op::HLT:
            return RVM_HALTED;
        case Op::NOP:
        case Op::PROC:
            pc_ = here + 1;
            break;
        case Op::BR:
            if (cond(i)) {
                if (i.target >= size) return fault("BR target outside code");
                const Instr l = decode(prog_.code[i.target]);
                if (l.op != Op::LND || l.target != here)
                    return fault("BR target is not an LND naming this branch");
                pc_ = i.target;
                jumped = true;
            } else {
                pc_ = here + 1;
            }
            break;
        case Op::LND:
            if (prev_.valid) {
                const bool expected = prev_.jumped && prev_.pc == i.target;
                if (cond(i) != expected) return fault("LND assertion failed");
            }
            pc_ = here + 1;
            break;
        case Op::CALL: {
            if (i.target >= size || decode(prog_.code[i.target]).op != Op::PROC)
                return fault("CALL target is not a PROC");
            const uint32_t slot = regs_[kSpReg];
            if (slot >= kRamWords) return fault("stack pointer outside writable memory");
            if (ram_[slot] != 0) return fault("stack slot above SP is not zero");
            set_mem(slot, here + 1);
            set_reg(kSpReg, slot + 1);
            pc_ = i.target;
            break;
        }
        case Op::RET: {
            const uint32_t slot = regs_[kSpReg] - 1;
            if (slot >= kRamWords) return fault("RET with stack pointer outside writable memory");
            const uint32_t v = ram_[slot];
            if (v == 0 || v >= size) return fault("RET to invalid address");
            const Instr call = decode(prog_.code[v - 1]);
            if (call.op != Op::CALL || call.target >= size) return fault("RET does not follow a CALL");
            const Instr proc = decode(prog_.code[call.target]);
            if (proc.op != Op::PROC || proc.target != here) return fault("RET is not the PROC's declared exit");
            set_mem(slot, 0);
            set_reg(kSpReg, slot);
            pc_ = v;
            break;
        }
        default: {
            const rvm_status s = apply_data(i, false);
            if (s != RVM_OK) return s;
            pc_ = here + 1;
        }
    }
    prev_ = Prev{true, jumped, here};
    return RVM_OK;
}

// The program run as its own inverse. Mirrors backward() in SPEC section 6.
rvm_status LoggingVm::exec_inverse() {
    const size_t size = prog_.code.size();
    if (pc_ >= size) return fault("PC outside code");
    if (pc_ == prog_.entry) return RVM_HALTED;  // nothing left to undo
    const uint32_t q = pc_;
    const Instr i = decode(prog_.code[q]);

    if (i.op == Op::LND && cond(i)) {  // undo the jump from S
        if (i.target >= size) return fault("LND source outside code");
        const Instr br = decode(prog_.code[i.target]);
        if (br.op != Op::BR || br.target != q) return fault("LND source is not a BR to this landing");
        pc_ = i.target;
    } else if (i.op == Op::PROC) {  // undo the CALL
        const uint32_t slot = regs_[kSpReg] - 1;
        if (slot >= kRamWords) return fault("stack pointer outside writable memory");
        const uint32_t ret = ram_[slot];
        if (ret == 0 || ret > size) return fault("bad return address on stack");
        const Instr call = decode(prog_.code[ret - 1]);
        if (call.op != Op::CALL || call.target != q) return fault("stacked return address does not match CALL");
        set_mem(slot, 0);
        set_reg(kSpReg, slot);
        pc_ = ret - 1;
    } else {
        if (q == 0) return fault("no predecessor");
        const Instr j = decode(prog_.code[q - 1]);
        if (j.op == Op::CALL) {  // undo the RET
            if (j.target >= size) return fault("CALL target outside code");
            const Instr proc = decode(prog_.code[j.target]);
            if (proc.op != Op::PROC || proc.target >= size) return fault("CALL target is not a PROC");
            const uint32_t slot = regs_[kSpReg];
            if (slot >= kRamWords) return fault("stack pointer outside writable memory");
            if (ram_[slot] != 0) return fault("stack slot above SP is not zero");
            set_mem(slot, q);
            set_reg(kSpReg, slot + 1);
            pc_ = proc.target;
        } else {  // j fell through
            switch (j.op) {
                case Op::HLT:
                case Op::RET:
                    return fault("predecessor cannot fall through");
                case Op::BR:
                    if (j.cc == kAl) return fault("predecessor cannot fall through");
                    break;
                case Op::NOP:
                case Op::LND:
                case Op::PROC:
                    break;
                default: {
                    const rvm_status s = apply_data(j, true);
                    if (s != RVM_OK) return s;
                }
            }
            pc_ = q - 1;
        }
    }
    prev_ = Prev{};
    return RVM_OK;
}

}  // namespace rev
