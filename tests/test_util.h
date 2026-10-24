// Tiny test harness plus helpers to build programs and snapshot VM state through the C API.
#pragma once

#include <cstdint>
#include <cstdio>
#include <vector>

#include "rvm/isa.h"
#include "rvm/program.h"
#include "vm_api.h"

inline int g_failures = 0;

#define CHECK(cond)                                                                \
    do {                                                                           \
        if (!(cond)) {                                                             \
            std::fprintf(stderr, "%s:%d: CHECK failed: %s\n", __FILE__, __LINE__, #cond); \
            ++g_failures;                                                          \
        }                                                                          \
    } while (0)

#define CHECK_EQ(a, b)                                                             \
    do {                                                                           \
        const auto va_ = (a);                                                      \
        const auto vb_ = (b);                                                      \
        if (!(va_ == vb_)) {                                                       \
            std::fprintf(stderr, "%s:%d: CHECK_EQ failed: %s (%llu) != %s (%llu)\n", __FILE__, \
                         __LINE__, #a, static_cast<unsigned long long>(va_), #b,   \
                         static_cast<unsigned long long>(vb_));                    \
            ++g_failures;                                                          \
        }                                                                          \
    } while (0)

// ---- instruction builders ----
namespace t {
using rev::Op;
inline uint32_t nop() { return rev::enc_r(Op::NOP, 0, 0, 0); }
inline uint32_t hlt() { return rev::enc_r(Op::HLT, 0, 0, 0); }
inline uint32_t rr(Op op, uint32_t ra, uint32_t rb) { return rev::enc_r(op, ra, rb, 0); }
inline uint32_t ri(Op op, uint32_t ra, int32_t imm) {
    return rev::enc_r(op, ra, 0, static_cast<uint32_t>(imm) & 0x3FFFF);
}
inline uint32_t xld(uint32_t ra, uint32_t rb, int32_t off) {
    return rev::enc_r(Op::XLD, ra, rb, static_cast<uint32_t>(off) & 0x3FFFF);
}
inline uint32_t xst(uint32_t ra, uint32_t rb, int32_t off) {
    return rev::enc_r(Op::XST, ra, rb, static_cast<uint32_t>(off) & 0x3FFFF);
}
inline uint32_t cswap(uint32_t rc, uint32_t ra, uint32_t rb) { return rev::enc_rrr(Op::CSWAP, ra, rb, rc); }
inline uint32_t toff(uint32_t ra, uint32_t rb, uint32_t rc) { return rev::enc_rrr(Op::TOFF, ra, rb, rc); }
inline uint32_t br(uint32_t cc, uint32_t ra, uint32_t rb, uint32_t target) {
    return rev::enc_b(Op::BR, ra, rb, cc, target);
}
inline uint32_t lnd(uint32_t cc, uint32_t ra, uint32_t rb, uint32_t src) {
    return rev::enc_b(Op::LND, ra, rb, cc, src);
}
inline uint32_t call(uint32_t target) { return rev::enc_b(Op::CALL, 0, 0, 0, target); }
inline uint32_t proc(uint32_t end) { return rev::enc_b(Op::PROC, 0, 0, 0, end); }
inline uint32_t ret() { return rev::enc_r(Op::RET, 0, 0, 0); }
}  // namespace t

// ---- VM wrapper ----
struct Vm {
    rvm_t* h = nullptr;
    explicit Vm(const std::vector<uint32_t>& code, const std::vector<uint32_t>& data = {},
                uint32_t entry = 0) {
        h = rvm_create(RVM_KIND_LOGGING);
        rev::Program p;
        p.entry = entry;
        p.code = code;
        p.data = data;
        const std::vector<uint8_t> img = rev::serialize_program(p);
        const rvm_status s = rvm_load_program(h, img.data(), img.size());
        CHECK_EQ(s, RVM_OK);
    }
    ~Vm() { rvm_destroy(h); }
    Vm(const Vm&) = delete;
    Vm& operator=(const Vm&) = delete;

    uint32_t reg(int i) const {
        uint32_t r[16], pc;
        rvm_get_registers(h, r, &pc);
        return r[i];
    }
    uint32_t pc() const {
        uint32_t r[16], pc;
        rvm_get_registers(h, r, &pc);
        return pc;
    }
    uint32_t mem(uint32_t addr) const {
        uint32_t w = 0;
        rvm_get_memory(h, addr, 1, &w);
        return w;
    }
    // Step forward until something other than OK; returns that status.
    rvm_status run(int max_steps = 100000) {
        for (int i = 0; i < max_steps; ++i) {
            const rvm_status s = rvm_step_forward(h);
            if (s != RVM_OK) return s;
        }
        return RVM_OK;
    }
};

// Registers, PC, and the memory regions programs in these tests touch.
struct Snap {
    uint32_t regs[16];
    uint32_t pc;
    std::vector<uint32_t> mem;
    bool operator==(const Snap& o) const {
        for (int i = 0; i < 16; ++i)
            if (regs[i] != o.regs[i]) return false;
        return pc == o.pc && mem == o.mem;
    }
};

inline Snap snap(const Vm& vm) {
    Snap s;
    rvm_get_registers(vm.h, s.regs, &s.pc);
    s.mem.resize(0x400 + 16 + 64);
    rvm_get_memory(vm.h, 0, 0x400, s.mem.data());
    rvm_get_memory(vm.h, rev::kStackBase, 16, s.mem.data() + 0x400);
    rvm_get_memory(vm.h, rev::kFbBase, 64, s.mem.data() + 0x410);
    return s;
}
