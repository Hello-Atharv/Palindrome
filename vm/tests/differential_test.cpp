// Differential tests: the reversible VM must match the logging VM (the oracle) at every instruction count.
// State equality = registers, PC, the memory regions in test_util.h's snap(), instruction count, direction,
// and the status returned by each call. Programs here are well-formed (they satisfy the BR/LND rules); the
// reversible VM cannot check LND assertions, so ill-formed programs are only tested on the logging VM.
#include <chrono>
#include <cstdio>
#include <string>
#include <vector>

#include "test_programs.h"
#include "test_util.h"

using namespace t;
using namespace progs;

namespace {

// Keeps reading the input window, so scrubbing and pushed input exercise the time-dependent reads.
std::vector<uint32_t> input_program() {
    std::vector<uint32_t> code{ri(Op::XORI, 1, 0x30000)};
    for (int i = 0; i < 40; ++i) {
        code.push_back(xld(2, 1, 1));  // COUNT
        code.push_back(xld(3, 1, 0));  // TIME
        code.push_back(xld(4, 1, 2));  // event 0
        code.push_back(ri(Op::ADDI, 5, 1));
    }
    code.push_back(hlt());
    return code;
}

// Counts to `limit` in a loop, 4 instructions per iteration.
std::vector<uint32_t> long_loop(int limit) {
    std::vector<uint32_t> p = loop_program();
    p[0] = ri(Op::ADDI, 1, limit);
    return p;
}

struct Pair {
    Vm oracle;
    Vm rev;
    Pair(const std::vector<uint32_t>& code, const std::vector<uint32_t>& data)
        : oracle(code, data, 0, RVM_KIND_LOGGING), rev(code, data, 0, RVM_KIND_REVERSIBLE) {}
    bool same() const {
        return rvm_instruction_count(oracle.h) == rvm_instruction_count(rev.h) &&
               rvm_get_direction(oracle.h) == rvm_get_direction(rev.h) && snap(oracle) == snap(rev);
    }
};

// A random scrub session applied identically to both VMs, comparing after every action.
void walk(const char* name, const std::vector<uint32_t>& code, const std::vector<uint32_t>& data,
          uint32_t seed, int ops) {
    Pair p(code, data);
    uint32_t s = seed;
    CHECK(p.same());
    for (int k = 0; k < ops; ++k) {
        const uint32_t r = lcg(s) % 24;
        rvm_status a, b;
        const char* what;
        if (r < 11) {
            what = "step_forward";
            a = rvm_step_forward(p.oracle.h);
            b = rvm_step_forward(p.rev.h);
        } else if (r < 17) {
            what = "step_back";
            a = rvm_step_back(p.oracle.h);
            b = rvm_step_back(p.rev.h);
        } else if (r < 21) {
            what = "run_to";
            const uint64_t target = lcg(s) % (rvm_instruction_count(p.oracle.h) + 40);
            a = rvm_run_to(p.oracle.h, target);
            b = rvm_run_to(p.rev.h, target);
        } else if (r < 22) {
            what = "set_direction";
            const int dir = (lcg(s) & 1) ? 1 : -1;
            a = rvm_set_direction(p.oracle.h, dir);
            b = rvm_set_direction(p.rev.h, dir);
        } else {
            what = "push_input";
            const uint32_t v = lcg(s);
            a = rvm_push_input(p.oracle.h, v);
            b = rvm_push_input(p.rev.h, v);
        }
        if (a != b || !p.same()) {
            std::fprintf(stderr, "DIVERGED: %s seed=%u op#%d (%s) at t=%llu: status %d vs %d\n", name, seed, k,
                         what, static_cast<unsigned long long>(rvm_instruction_count(p.oracle.h)), a, b);
            ++g_failures;
            return;
        }
    }
}

void test_walks_structured() {
    for (uint32_t seed = 1; seed <= 40; ++seed) {
        walk("ifelse(5)", ifelse_program(5), {}, seed, 400);
        walk("ifelse(9)", ifelse_program(9), {}, seed, 400);
        walk("loop", loop_program(), {}, seed, 600);
        walk("call", call_program(), {}, seed, 400);
        walk("input", input_program(), {}, seed, 600);
    }
}

void test_walks_random_programs() {
    std::vector<uint32_t> data(0x400);
    uint32_t s = 777;
    for (uint32_t& w : data) w = lcg(s) * 2654435761u;
    for (uint32_t seed = 1; seed <= 30; ++seed) walk("random", random_program(seed, 200), data, seed * 7919, 500);
}

void test_operand_faults_match() {
    const uint32_t bad[] = {rr(Op::ADD, 1, 1), rr(Op::XOR, 2, 2), cswap(1, 1, 2), toff(1, 1, 2),
                            xst(1, 3, 0), xld(1, 4, 0)};
    for (uint32_t w : bad) {
        Pair p({ri(Op::XORI, 3, 0x30000), ri(Op::XORI, 4, 0x25000), ri(Op::ADDI, 1, 7), w, hlt()}, {});
        CHECK_EQ(rvm_run_to(p.oracle.h, 3), RVM_OK);
        CHECK_EQ(rvm_run_to(p.rev.h, 3), RVM_OK);
        const Snap before = snap(p.rev);
        CHECK_EQ(rvm_step_forward(p.oracle.h), RVM_FAULT);
        CHECK_EQ(rvm_step_forward(p.rev.h), RVM_FAULT);
        CHECK(snap(p.rev) == before);  // a fault leaves the reversible VM's state unchanged too
        CHECK(p.same());
    }
}

void test_no_history_and_long_rewind() {
    const int kLimit = 50000;
    Pair p(long_loop(kLimit), {});
    const Snap start = snap(p.rev);
    using clock = std::chrono::steady_clock;

    auto t0 = clock::now();
    rvm_status s;
    while ((s = rvm_step_forward(p.rev.h)) == RVM_OK) {}
    auto t1 = clock::now();
    CHECK_EQ(s, RVM_HALTED);
    const uint64_t steps = rvm_instruction_count(p.rev.h);
    CHECK_EQ(steps, 1u + 4u * kLimit);
    CHECK_EQ(snap(p.rev).regs[3], static_cast<uint32_t>(kLimit) * static_cast<uint32_t>(kLimit));
    CHECK_EQ(rvm_history_bytes(p.rev.h), 0u);  // no history at all, after 200,001 steps

    CHECK_EQ(rvm_run_to(p.oracle.h, steps), RVM_OK);
    CHECK(p.same());
    CHECK(rvm_history_bytes(p.oracle.h) >= 48 * steps);  // the diary grows with every step

    t0 = clock::now();
    CHECK_EQ(rvm_run_to(p.rev.h, 0), RVM_OK);  // rewind every step by computing inverses
    t1 = clock::now();
    CHECK(snap(p.rev) == start);
    const double ms = std::chrono::duration<double, std::milli>(t1 - t0).count();
    std::printf("  rewound %llu steps with %zu bytes of history in %.1f ms (oracle diary: %zu bytes)\n",
                static_cast<unsigned long long>(steps), rvm_history_bytes(p.rev.h), ms,
                rvm_history_bytes(p.oracle.h));
}

}  // namespace

int main() {
    struct {
        const char* name;
        void (*fn)();
    } tests[] = {
        {"walks_structured", test_walks_structured},
        {"walks_random_programs", test_walks_random_programs},
        {"operand_faults_match", test_operand_faults_match},
        {"no_history_and_long_rewind", test_no_history_and_long_rewind},
    };
    for (auto& tc : tests) {
        const int before = g_failures;
        tc.fn();
        std::printf("%-40s %s\n", tc.name, g_failures == before ? "ok" : "FAILED");
    }
    return g_failures == 0 ? 0 : 1;
}
