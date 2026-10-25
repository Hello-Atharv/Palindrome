// Small programs shared by the tests: structured examples from SPEC section 6 and a random generator.
#pragma once

#include <cstdint>
#include <utility>
#include <vector>

#include "test_util.h"

namespace progs {
using rev::Op;
using namespace t;

// if (r1 == r2) r3 += 7 else r3 += 100, exactly as the SPEC section 6 example.
inline std::vector<uint32_t> ifelse_program(int r2) {
    return {
        ri(Op::ADDI, 1, 5),        // 0
        ri(Op::ADDI, 2, r2),       // 1
        br(rev::kEq, 1, 2, 5),     // 2  S0
        ri(Op::ADDI, 3, 100),      // 3  else body
        br(rev::kAl, 0, 0, 7),     // 4  S1
        lnd(rev::kAl, 0, 0, 2),    // 5  Lthen, entered only from S0
        ri(Op::ADDI, 3, 7),        // 6  then body
        lnd(rev::kNe, 1, 2, 4),    // 7  Lend: true iff we came from the else side
        hlt(),                     // 8
    };
}

// r3 = 4 * 4: loop with the head asserting "arrived by the back edge iff r2 != 0".
inline std::vector<uint32_t> loop_program() {
    return {
        ri(Op::ADDI, 1, 4),        // 0
        lnd(rev::kNe, 2, 0, 4),    // 1  head
        rr(Op::ADD, 3, 1),         // 2
        ri(Op::ADDI, 2, 1),        // 3
        br(rev::kNe, 2, 1, 1),     // 4  back edge
        hlt(),                     // 5
    };
}

// Calls f twice; f does r2 += r1.
inline std::vector<uint32_t> call_program() {
    return {
        ri(Op::ADDI, 1, 3),        // 0
        call(4),                   // 1
        call(4),                   // 2
        hlt(),                     // 3
        proc(6),                   // 4  f
        rr(Op::ADD, 2, 1),         // 5
        ret(),                     // 6
    };
}

// Deterministic pseudo-random straight-line programs over all data instructions.
inline uint32_t lcg(uint32_t& s) {
    s = s * 1664525u + 1013904223u;
    return s >> 8;
}

inline std::vector<uint32_t> random_program(uint32_t seed, int len) {
    std::vector<uint32_t> code;
    code.push_back(ri(Op::XORI, 9, 0x100));  // r9 = base for memory ops; never written again
    auto reg = [&] { return 1 + lcg(seed) % 8; };  // r1..r8
    auto two = [&](uint32_t& a, uint32_t& b) {
        a = reg();
        do b = reg(); while (b == a);
    };
    for (int i = 0; i < len; ++i) {
        uint32_t a, b, c;
        const int imm = static_cast<int>(lcg(seed) % 200001) - 100000;
        switch (lcg(seed) % 12) {
            case 0: two(a, b); code.push_back(rr(Op::ADD, a, b)); break;
            case 1: two(a, b); code.push_back(rr(Op::SUB, a, b)); break;
            case 2: code.push_back(ri(Op::ADDI, reg(), imm)); break;
            case 3: two(a, b); code.push_back(rr(Op::XOR, a, b)); break;
            case 4: code.push_back(ri(Op::XORI, reg(), imm & 0x3FFFF)); break;
            case 5: code.push_back(ri(Op::NOT, reg(), 0)); break;
            case 6: two(a, b); code.push_back(rr(Op::SWAP, a, b)); break;
            case 7: code.push_back(ri(Op::ROLI, reg(), static_cast<int>(lcg(seed) % 40))); break;
            case 8: code.push_back(xld(reg(), 9, static_cast<int>(lcg(seed) % 0x200))); break;
            case 9: code.push_back(xst(reg(), 9, static_cast<int>(lcg(seed) % 0x200))); break;
            case 10:
                two(a, b);
                do c = reg(); while (c == a || c == b);
                code.push_back(cswap(c, a, b));
                break;
            default:
                two(a, b);
                do c = reg(); while (c == a || c == b);
                code.push_back(toff(a, b, c));
        }
    }
    code.push_back(hlt());
    return code;
}

inline std::vector<uint8_t> make_tape(const std::vector<std::pair<uint32_t, uint32_t>>& ev) {
    std::vector<uint8_t> v;
    auto w32 = [&](uint32_t x) {
        for (int i = 0; i < 4; ++i) v.push_back(static_cast<uint8_t>(x >> (8 * i)));
    };
    w32(0x544D5652u);
    w32(static_cast<uint32_t>(ev.size()));
    for (auto& e : ev) {
        w32(e.first);
        w32(e.second);
    }
    return v;
}

}  // namespace progs
