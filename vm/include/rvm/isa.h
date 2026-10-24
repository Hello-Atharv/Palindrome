// ISA constants, opcodes and encode/decode helpers. Mirrors spec/SPEC.md sections 3-5.
#pragma once

#include <cstdint>

namespace rev {

constexpr uint32_t kNumRegs = 16;
constexpr uint32_t kSpReg = 14;
constexpr uint32_t kStackBase = 0x10000;
constexpr uint32_t kRamWords = 0x20800;  // RW: data + stack + framebuffer, contiguous from 0
constexpr uint32_t kFbBase = 0x20000;
constexpr uint32_t kFbWords = 64 * 32;
constexpr uint32_t kInBase = 0x30000;  // RO input window
constexpr uint32_t kInEnd = 0x40000;
constexpr uint32_t kMaxCodeWords = 65536;
constexpr uint32_t kMaxDataWords = 65536;

enum class Op : uint8_t {
    NOP, HLT, ADD, SUB, ADDI, XOR, XORI, NOT, SWAP, ROLI,
    XLD, XST, CSWAP, TOFF, BR, LND, CALL, PROC, RET,
};
constexpr uint32_t kOpCount = 19;

enum Cond : uint8_t { kAl = 0, kEq = 1, kNe = 2, kLt = 3 };

struct Instr {
    Op op;
    uint8_t ra, rb, rc, cc;
    uint16_t target;  // format B target / PROC end address
    uint32_t imm18;   // zero-extended
    uint32_t simm;    // sign-extended imm18 (as uint32, for wraparound adds)
};

inline bool valid_opcode(uint32_t word) { return (word >> 26) < kOpCount; }

inline Instr decode(uint32_t w) {
    Instr i;
    i.op = static_cast<Op>(w >> 26);
    i.ra = static_cast<uint8_t>((w >> 22) & 15);
    i.rb = static_cast<uint8_t>((w >> 18) & 15);
    i.rc = static_cast<uint8_t>((w >> 14) & 15);
    i.cc = static_cast<uint8_t>((w >> 16) & 3);
    i.target = static_cast<uint16_t>(w & 0xFFFF);
    i.imm18 = w & 0x3FFFF;
    i.simm = (i.imm18 & 0x20000) ? (i.imm18 | 0xFFFC0000u) : i.imm18;
    return i;
}

inline uint32_t enc_r(Op op, uint32_t ra, uint32_t rb, uint32_t imm18) {
    return (static_cast<uint32_t>(op) << 26) | (ra << 22) | (rb << 18) | (imm18 & 0x3FFFF);
}
inline uint32_t enc_rrr(Op op, uint32_t ra, uint32_t rb, uint32_t rc) {
    return (static_cast<uint32_t>(op) << 26) | (ra << 22) | (rb << 18) | (rc << 14);
}
inline uint32_t enc_b(Op op, uint32_t ra, uint32_t rb, uint32_t cc, uint32_t target) {
    return (static_cast<uint32_t>(op) << 26) | (ra << 22) | (rb << 18) | (cc << 16) | (target & 0xFFFF);
}

}  // namespace rev
