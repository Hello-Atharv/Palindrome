// Tests for the logging VM (the oracle), through the C API.
#include <cstdio>
#include <string>
#include <utility>
#include <vector>

#include "test_programs.h"
#include "test_util.h"

using rev::Op;
using namespace t;
using namespace progs;

namespace {

void test_reset_state() {
    Vm vm({nop(), hlt()});
    CHECK_EQ(vm.reg(14), rev::kStackBase);
    for (int i = 0; i < 14; ++i) CHECK_EQ(vm.reg(i), 0u);
    CHECK_EQ(vm.pc(), 0u);
    CHECK_EQ(rvm_instruction_count(vm.h), 0u);
    CHECK_EQ(rvm_step_back(vm.h), RVM_AT_START);
    CHECK_EQ(rvm_get_direction(vm.h), 1);
}

void test_load_rejects_garbage() {
    rvm_t* h = rvm_create(RVM_KIND_LOGGING);
    const uint8_t junk[40] = {1, 2, 3};
    CHECK_EQ(rvm_load_program(h, junk, sizeof junk), RVM_BAD_PROGRAM);
    rev::Program p;
    p.code = {0xFFFFFFFFu};  // undefined opcode
    const auto img = rev::serialize_program(p);
    CHECK_EQ(rvm_load_program(h, img.data(), img.size()), RVM_BAD_PROGRAM);
    CHECK_EQ(rvm_step_forward(h), RVM_BAD_ARG);  // nothing loaded
    rvm_destroy(h);
}

void test_data_ops() {
    Vm vm({
        ri(Op::ADDI, 1, 5),          // 0  r1 = 5
        ri(Op::ADDI, 2, -3),         // 1  r2 = -3
        rr(Op::ADD, 1, 2),           // 2  r1 = 2
        rr(Op::SUB, 2, 1),           // 3  r2 = -5
        ri(Op::XORI, 3, 0xF0F0),     // 4
        rr(Op::XOR, 3, 1),           // 5  r3 = 0xF0F2
        ri(Op::NOT, 4, 0),           // 6  r4 = ~0
        rr(Op::SWAP, 1, 4),          // 7  r1 = ~0, r4 = 2
        ri(Op::XORI, 5, 0x20001),    // 8
        ri(Op::ROLI, 5, 16),         // 9  r5 = 0x00010002
        ri(Op::XORI, 6, 0x100),      // 10 base
        xst(3, 6, 4),                // 11 mem[0x104] = 0xF0F2
        xld(7, 6, 4),                // 12 r7 = 0xF0F2
        ri(Op::ADDI, 9, 1),          // 13
        ri(Op::ADDI, 10, 7),         // 14
        ri(Op::ADDI, 11, 9),         // 15
        cswap(9, 10, 11),            // 16 r10 = 9, r11 = 7
        toff(12, 10, 11),            // 17 r12 ^= 9 & 7 = 1
        hlt(),
    });
    CHECK_EQ(vm.run(), RVM_HALTED);
    CHECK_EQ(vm.reg(1), 0xFFFFFFFFu);
    CHECK_EQ(vm.reg(2), 0xFFFFFFFBu);
    CHECK_EQ(vm.reg(3), 0xF0F2u);
    CHECK_EQ(vm.reg(4), 2u);
    CHECK_EQ(vm.reg(5), 0x00010002u);
    CHECK_EQ(vm.mem(0x104), 0xF0F2u);
    CHECK_EQ(vm.reg(7), 0xF0F2u);
    CHECK_EQ(vm.reg(10), 9u);
    CHECK_EQ(vm.reg(11), 7u);
    CHECK_EQ(vm.reg(12), 1u);
    CHECK_EQ(rvm_instruction_count(vm.h), 18u);
}

void test_wraparound() {
    Vm vm({ri(Op::NOT, 1, 0), ri(Op::ADDI, 2, 1), rr(Op::ADD, 1, 2), hlt()});
    CHECK_EQ(vm.run(), RVM_HALTED);
    CHECK_EQ(vm.reg(1), 0u);  // 0xFFFFFFFF + 1 wraps
}

void test_faults_leave_state_unchanged() {
    struct Case {
        const char* name;
        uint32_t bad;
    } cases[] = {
        {"ADD r1,r1", rr(Op::ADD, 1, 1)},
        {"XOR r2,r2", rr(Op::XOR, 2, 2)},
        {"CSWAP rc==ra", cswap(1, 1, 2)},
        {"TOFF ra==rb", toff(1, 1, 2)},
        {"XST to input window", xst(1, 3, 0)},   // r3 set to 0x30000 below
        {"XLD unmapped", xld(1, 4, 0)},          // r4 set to 0x25000 below
    };
    for (const Case& c : cases) {
        Vm vm({ri(Op::XORI, 3, 0x30000), ri(Op::XORI, 4, 0x25000), ri(Op::ADDI, 1, 7), c.bad, hlt()});
        CHECK_EQ(rvm_run_to(vm.h, 3), RVM_OK);
        const Snap before = snap(vm);
        const rvm_status s = rvm_step_forward(vm.h);
        if (s != RVM_FAULT) std::fprintf(stderr, "case %s: status %d\n", c.name, s);
        CHECK_EQ(s, RVM_FAULT);
        CHECK(snap(vm) == before);
        CHECK_EQ(rvm_instruction_count(vm.h), 3u);
        CHECK(rvm_last_error(vm.h)[0] != '\0');
    }
}

// Run to halt recording a snapshot per t, step all the way back checking each one, then run the
// whole program as its own inverse (d = -1) and check we land exactly on the initial state.
void check_roundtrips(const std::vector<uint32_t>& code, const std::vector<uint32_t>& data = {}) {
    Vm vm(code, data);
    std::vector<Snap> snaps{snap(vm)};
    rvm_status s;
    while ((s = rvm_step_forward(vm.h)) == RVM_OK) snaps.push_back(snap(vm));
    CHECK_EQ(s, RVM_HALTED);
    const uint64_t n = rvm_instruction_count(vm.h);
    CHECK_EQ(n, snaps.size() - 1);

    // 1. time travel: step_back restores every snapshot
    for (uint64_t k = n; k-- > 0;) {
        CHECK_EQ(rvm_step_back(vm.h), RVM_OK);
        CHECK(snap(vm) == snaps[k]);
    }
    CHECK_EQ(rvm_step_back(vm.h), RVM_AT_START);

    // 2. run_to jumps both ways
    CHECK_EQ(rvm_run_to(vm.h, n), RVM_OK);
    CHECK(snap(vm) == snaps[n]);
    CHECK_EQ(rvm_run_to(vm.h, n / 2), RVM_OK);
    CHECK(snap(vm) == snaps[n / 2]);
    CHECK_EQ(rvm_run_to(vm.h, n), RVM_OK);

    // 3. program direction -1: execute the inverse program back to the start
    CHECK_EQ(rvm_set_direction(vm.h, -1), RVM_OK);
    CHECK_EQ(rvm_get_direction(vm.h), -1);
    std::vector<Snap> back{snap(vm)};
    int guard = 0;
    while ((s = rvm_step_forward(vm.h)) == RVM_OK && ++guard < 100000) back.push_back(snap(vm));
    CHECK_EQ(s, RVM_HALTED);
    CHECK(snap(vm) == snaps[0]);
    CHECK_EQ(back.size() - 1, n);  // the inverse run retraces the same number of steps
    for (size_t k = 0; k < back.size(); ++k) CHECK(back[k] == snaps[n - k]);

    // 4. time travel through the d = -1 region is also exact
    for (size_t k = back.size() - 1; k-- > 0;) {
        CHECK_EQ(rvm_step_back(vm.h), RVM_OK);
        CHECK(snap(vm) == back[k]);
    }
}

void test_ifelse() {
    for (int r2 : {5, 9}) {
        Vm vm(ifelse_program(r2));
        CHECK_EQ(vm.run(), RVM_HALTED);
        CHECK_EQ(vm.reg(3), r2 == 5 ? 7u : 100u);
        check_roundtrips(ifelse_program(r2));
    }
}

void test_loop() {
    Vm vm(loop_program());
    CHECK_EQ(vm.run(), RVM_HALTED);
    CHECK_EQ(vm.reg(3), 16u);
    CHECK_EQ(vm.reg(2), 4u);
    check_roundtrips(loop_program());
}

void test_call_return() {
    Vm vm(call_program());
    CHECK_EQ(vm.run(), RVM_HALTED);
    CHECK_EQ(vm.reg(2), 6u);
    CHECK_EQ(vm.reg(14), rev::kStackBase);  // balanced
    CHECK_EQ(vm.mem(rev::kStackBase), 0u);  // slot returned to zero, no stack garbage
    CHECK_EQ(vm.mem(rev::kStackBase + 1), 0u);
    check_roundtrips(call_program());
}

void test_lnd_assertion_is_checked() {
    // Then-path reaches Lend by fall-through, but the landing claims "arrived by jump".
    std::vector<uint32_t> p = ifelse_program(5);
    p[7] = lnd(rev::kAl, 0, 0, 4);
    Vm vm(p);
    CHECK_EQ(vm.run(), RVM_FAULT);
    CHECK_EQ(vm.pc(), 7u);
    CHECK(std::string(rvm_last_error(vm.h)).find("LND") != std::string::npos);
}

void test_branch_target_must_be_matching_lnd() {
    std::vector<uint32_t> p = ifelse_program(5);
    p[5] = nop();  // Lthen is no longer a landing
    Vm vm(p);
    CHECK_EQ(vm.run(), RVM_FAULT);
}

void test_stack_garbage_is_a_fault() {
    // CALL with a non-zero slot above SP violates the stack invariant.
    Vm vm({ri(Op::XORI, 5, rev::kStackBase), ri(Op::XORI, 6, 9), xst(6, 5, 0), call(5), hlt(), proc(6), ret()});
    CHECK_EQ(vm.run(), RVM_FAULT);
}

void test_random_programs_roundtrip() {
    std::vector<uint32_t> data(0x400);
    uint32_t s = 12345;
    for (uint32_t& w : data) w = lcg(s) * 2654435761u;
    for (uint32_t seed = 1; seed <= 25; ++seed) check_roundtrips(random_program(seed, 300), data);
}

void test_input_window() {
    Vm vm({
        ri(Op::XORI, 1, 0x30000),  // 0  r1 = IN_BASE
        xld(2, 1, 1),              // 1  r2 = COUNT   (read at t=1)
        xld(3, 1, 0),              // 2  r3 = TIME    (read at t=2)
        xld(4, 1, 2),              // 3  r4 = event 0 (read at t=3)
        xld(5, 1, 3),              // 4  r5 = event 1 (read at t=4)
        hlt(),
    });
    const auto tape = make_tape({{0, 111}, {4, 222}});
    CHECK_EQ(rvm_set_input_tape(vm.h, tape.data(), tape.size()), RVM_OK);
    CHECK_EQ(vm.run(), RVM_HALTED);
    CHECK_EQ(vm.reg(2), 1u);    // only the t=0 event is visible at t=1
    CHECK_EQ(vm.reg(3), 2u);
    CHECK_EQ(vm.reg(4), 111u);
    CHECK_EQ(vm.reg(5), 222u);  // event at t=4 is visible to the step starting at t=4
    // Going back un-consumes: rerun the same steps and get the same values.
    CHECK_EQ(rvm_run_to(vm.h, 0), RVM_OK);
    CHECK_EQ(vm.reg(4), 0u);
    CHECK_EQ(vm.run(), RVM_HALTED);
    CHECK_EQ(vm.reg(4), 111u);
    // Window is read-only and the tape file is validated.
    uint32_t w;
    CHECK_EQ(rvm_get_memory(vm.h, 0x30001, 1, &w), RVM_OK);
    CHECK_EQ(w, 2u);
    const uint8_t bad[3] = {1, 2, 3};
    CHECK_EQ(rvm_set_input_tape(vm.h, bad, sizeof bad), RVM_BAD_ARG);
}

void test_push_input_branches() {
    Vm vm({ri(Op::XORI, 1, 0x30000), nop(), nop(), xld(2, 1, 2), hlt()});
    CHECK_EQ(rvm_run_to(vm.h, 2), RVM_OK);
    CHECK_EQ(rvm_push_input(vm.h, 7), RVM_OK);  // stamped at t=2
    CHECK_EQ(vm.run(), RVM_HALTED);
    CHECK_EQ(vm.reg(2), 7u);
    // Scrub back before the event, push a different value: the old one is gone.
    CHECK_EQ(rvm_run_to(vm.h, 1), RVM_OK);
    CHECK_EQ(rvm_push_input(vm.h, 9), RVM_OK);  // stamped at t=1, drops nothing earlier
    CHECK_EQ(vm.run(), RVM_HALTED);
    CHECK_EQ(vm.reg(2), 9u);  // event 0 is now the t=1 event; the t=2 event (7) was dropped
}

void test_direction_log() {
    Vm vm({nop(), nop(), nop(), nop(), nop(), nop(), hlt()});
    CHECK_EQ(rvm_set_direction(vm.h, 2), RVM_BAD_ARG);
    CHECK_EQ(rvm_run_to(vm.h, 3), RVM_OK);
    CHECK_EQ(rvm_set_direction(vm.h, -1), RVM_OK);
    CHECK_EQ(rvm_get_direction(vm.h), -1);
    CHECK_EQ(rvm_run_to(vm.h, 1), RVM_OK);
    CHECK_EQ(rvm_get_direction(vm.h), 1);   // before the flip
    CHECK_EQ(rvm_run_to(vm.h, 3), RVM_OK);
    CHECK_EQ(rvm_get_direction(vm.h), -1);  // flip survives scrubbing
    CHECK_EQ(rvm_run_to(vm.h, 1), RVM_OK);
    CHECK_EQ(rvm_set_direction(vm.h, 1), RVM_OK);  // host action at t=1 starts a new branch
    CHECK_EQ(rvm_run_to(vm.h, 3), RVM_OK);
    CHECK_EQ(rvm_get_direction(vm.h), 1);
    CHECK_EQ(rvm_history_bytes(vm.h) > 0, true);
}

void test_history_bytes_tracks_time() {
    Vm vm(random_program(3, 100));
    CHECK_EQ(rvm_history_bytes(vm.h), 0u);
    CHECK_EQ(rvm_run_to(vm.h, 50), RVM_OK);
    const size_t at50 = rvm_history_bytes(vm.h);
    CHECK(at50 > 0);
    CHECK_EQ(rvm_run_to(vm.h, 100), RVM_OK);
    CHECK_EQ(rvm_history_bytes(vm.h), 2 * at50);
    CHECK_EQ(rvm_run_to(vm.h, 50), RVM_OK);
    CHECK_EQ(rvm_history_bytes(vm.h), at50);
}

void test_get_code_and_bad_args() {
    Vm vm({nop(), hlt()});
    uint32_t w[2];
    CHECK_EQ(rvm_get_code(vm.h, 0, 2, w), RVM_OK);
    CHECK_EQ(w[1], hlt());
    CHECK_EQ(rvm_get_code(vm.h, 1, 2, w), RVM_BAD_ARG);
    CHECK_EQ(rvm_get_memory(vm.h, 0x25000, 1, w), RVM_BAD_ARG);
    CHECK_EQ(rvm_get_memory(nullptr, 0, 1, w), RVM_BAD_ARG);
}

}  // namespace

int main() {
    struct {
        const char* name;
        void (*fn)();
    } tests[] = {
        {"reset_state", test_reset_state},
        {"load_rejects_garbage", test_load_rejects_garbage},
        {"data_ops", test_data_ops},
        {"wraparound", test_wraparound},
        {"faults_leave_state_unchanged", test_faults_leave_state_unchanged},
        {"ifelse", test_ifelse},
        {"loop", test_loop},
        {"call_return", test_call_return},
        {"lnd_assertion_is_checked", test_lnd_assertion_is_checked},
        {"branch_target_must_be_matching_lnd", test_branch_target_must_be_matching_lnd},
        {"stack_garbage_is_a_fault", test_stack_garbage_is_a_fault},
        {"random_programs_roundtrip", test_random_programs_roundtrip},
        {"input_window", test_input_window},
        {"push_input_branches", test_push_input_branches},
        {"direction_log", test_direction_log},
        {"history_bytes_tracks_time", test_history_bytes_tracks_time},
        {"get_code_and_bad_args", test_get_code_and_bad_args},
    };
    for (auto& tc : tests) {
        const int before = g_failures;
        tc.fn();
        std::printf("%-40s %s\n", tc.name, g_failures == before ? "ok" : "FAILED");
    }
    return g_failures == 0 ? 0 : 1;
}
