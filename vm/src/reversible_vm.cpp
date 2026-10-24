#include "reversible_vm.h"

#include <utility>

namespace rev {

rvm_status ReversibleVm::step_forward() {
    if (!loaded_) {
        err_ = "no program loaded";
        return RVM_BAD_ARG;
    }
    const uint64_t now = t_;
    const rvm_status s = dirlog_.at(now) > 0 ? exec_forward(now) : exec_inverse(now);
    if (s == RVM_OK) ++t_;
    return s;
}

// Undo the step t-1 -> t by running the inverse of whichever direction that step used.
rvm_status ReversibleVm::step_back() {
    if (!loaded_) {
        err_ = "no program loaded";
        return RVM_BAD_ARG;
    }
    if (t_ == 0) return RVM_AT_START;
    const uint64_t now = t_ - 1;
    const rvm_status s = dirlog_.at(now) > 0 ? exec_inverse(now) : exec_forward(now);
    if (s == RVM_HALTED) return fault("cannot undo this step");  // unreachable for a real trace
    if (s == RVM_OK) --t_;
    return s;
}

// Data instructions (ADD..TOFF). `inverse` applies the Inverse column of SPEC section 4.
rvm_status ReversibleVm::apply_data(const Instr& i, bool inverse, uint64_t now) {
    const uint32_t a = i.ra, b = i.rb, c = i.rc;
    switch (i.op) {
        case Op::ADD:
        case Op::SUB: {
            if (a == b) return fault("ADD/SUB operands must differ");
            const bool add = (i.op == Op::ADD) != inverse;
            regs_[a] = add ? regs_[a] + regs_[b] : regs_[a] - regs_[b];
            break;
        }
        case Op::ADDI:
            regs_[a] = inverse ? regs_[a] - i.simm : regs_[a] + i.simm;
            break;
        case Op::XOR:
            if (a == b) return fault("XOR operands must differ");
            regs_[a] ^= regs_[b];
            break;
        case Op::XORI:
            regs_[a] ^= i.imm18;
            break;
        case Op::NOT:
            regs_[a] = ~regs_[a];
            break;
        case Op::SWAP:
            std::swap(regs_[a], regs_[b]);
            break;
        case Op::ROLI: {
            const uint32_t k = i.imm18 & 31;
            regs_[a] = rotl(regs_[a], inverse ? (32 - k) & 31 : k);
            break;
        }
        case Op::XLD: {
            if (a == b) return fault("XLD operands must differ");
            uint32_t w;
            if (!read_word(regs_[b] + i.simm, now, &w)) return fault("XLD from unmapped address");
            regs_[a] ^= w;
            break;
        }
        case Op::XST: {
            const uint32_t addr = regs_[b] + i.simm;
            if (addr >= kRamWords) return fault("XST to non-writable address");
            ram_[addr] ^= regs_[a];
            break;
        }
        case Op::CSWAP:
            if (c == a || c == b) return fault("CSWAP control register must differ from operands");
            if (regs_[c] != 0) std::swap(regs_[a], regs_[b]);
            break;
        case Op::TOFF:
            if (a == b || a == c) return fault("TOFF target must differ from controls");
            regs_[a] ^= regs_[b] & regs_[c];
            break;
        default:
            return fault("internal: not a data instruction");
    }
    return RVM_OK;
}

rvm_status ReversibleVm::exec_forward(uint64_t now) {
    const size_t size = prog_.code.size();
    if (pc_ >= size) return fault("PC outside code");
    const Instr i = decode(prog_.code[pc_]);
    const uint32_t here = pc_;

    switch (i.op) {
        case Op::HLT:
            return RVM_HALTED;
        case Op::NOP:
        case Op::PROC:
        case Op::LND:  // the assertion cannot be checked without history; trusted
            pc_ = here + 1;
            return RVM_OK;
        case Op::BR:
            if (cond(i)) {
                if (i.target >= size) return fault("BR target outside code");
                const Instr l = decode(prog_.code[i.target]);
                if (l.op != Op::LND || l.target != here)
                    return fault("BR target is not an LND naming this branch");
                pc_ = i.target;
            } else {
                pc_ = here + 1;
            }
            return RVM_OK;
        case Op::CALL: {
            if (i.target >= size || decode(prog_.code[i.target]).op != Op::PROC)
                return fault("CALL target is not a PROC");
            const uint32_t slot = regs_[kSpReg];
            if (slot >= kRamWords) return fault("stack pointer outside writable memory");
            if (ram_[slot] != 0) return fault("stack slot above SP is not zero");
            ram_[slot] ^= here + 1;
            regs_[kSpReg] = slot + 1;
            pc_ = i.target;
            return RVM_OK;
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
            ram_[slot] ^= v;  // back to zero
            regs_[kSpReg] = slot;
            pc_ = v;
            return RVM_OK;
        }
        default: {
            const rvm_status s = apply_data(i, false, now);
            if (s == RVM_OK) pc_ = here + 1;
            return s;
        }
    }
}

// The inverse of exec_forward, found from the current state alone. Mirrors backward() in SPEC section 6.
rvm_status ReversibleVm::exec_inverse(uint64_t now) {
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
        return RVM_OK;
    }
    if (i.op == Op::PROC) {  // undo the CALL
        const uint32_t slot = regs_[kSpReg] - 1;
        if (slot >= kRamWords) return fault("stack pointer outside writable memory");
        const uint32_t ret = ram_[slot];
        if (ret == 0 || ret > size) return fault("bad return address on stack");
        const Instr call = decode(prog_.code[ret - 1]);
        if (call.op != Op::CALL || call.target != q) return fault("stacked return address does not match CALL");
        ram_[slot] ^= ret;  // back to zero
        regs_[kSpReg] = slot;
        pc_ = ret - 1;
        return RVM_OK;
    }
    if (q == 0) return fault("no predecessor");
    const Instr j = decode(prog_.code[q - 1]);
    if (j.op == Op::CALL) {  // undo the RET
        if (j.target >= size) return fault("CALL target outside code");
        const Instr proc = decode(prog_.code[j.target]);
        if (proc.op != Op::PROC || proc.target >= size) return fault("CALL target is not a PROC");
        const uint32_t slot = regs_[kSpReg];
        if (slot >= kRamWords) return fault("stack pointer outside writable memory");
        if (ram_[slot] != 0) return fault("stack slot above SP is not zero");
        ram_[slot] ^= q;
        regs_[kSpReg] = slot + 1;
        pc_ = proc.target;
        return RVM_OK;
    }
    switch (j.op) {  // j fell through
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
            const rvm_status s = apply_data(j, true, now);
            if (s != RVM_OK) return s;
        }
    }
    pc_ = q - 1;
    return RVM_OK;
}

}  // namespace rev
