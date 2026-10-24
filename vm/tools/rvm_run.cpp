// rvm_run: run a .rvm program on either engine and print the result.
//   rvm_run prog.rvm [--engine logging|reversible] [--tape f.tape] [--max-steps N] [--dir -1]
//                    [--rewind] [--mem addr] ...
// Output is "key value" lines. Exit code: 0 halted, 1 fault, 2 step limit, 3 usage/load error, 4 rewind mismatch.
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>

#include "vm_api.h"

namespace {

bool read_file(const char* path, std::vector<uint8_t>& out) {
    std::ifstream f(path, std::ios::binary);
    if (!f) return false;
    out.assign(std::istreambuf_iterator<char>(f), std::istreambuf_iterator<char>());
    return true;
}

struct Snapshot {
    uint32_t regs[16];
    uint32_t pc;
    std::vector<uint32_t> mem;
    bool operator==(const Snapshot& o) const {
        return pc == o.pc && std::memcmp(regs, o.regs, sizeof regs) == 0 && mem == o.mem;
    }
};

Snapshot snapshot(const rvm_t* vm) {
    Snapshot s;
    rvm_get_registers(vm, s.regs, &s.pc);
    s.mem.resize(0x400 + 16 + 2048);
    rvm_get_memory(vm, 0, 0x400, s.mem.data());
    rvm_get_memory(vm, 0x10000, 16, s.mem.data() + 0x400);
    rvm_get_memory(vm, 0x20000, 2048, s.mem.data() + 0x410);
    return s;
}

const char* name(rvm_status s) {
    switch (s) {
        case RVM_OK: return "OK";
        case RVM_HALTED: return "HALTED";
        case RVM_AT_START: return "AT_START";
        case RVM_FAULT: return "FAULT";
        case RVM_BAD_ARG: return "BAD_ARG";
        default: return "BAD_PROGRAM";
    }
}

int usage() {
    std::fprintf(stderr,
                 "usage: rvm_run prog.rvm [--engine logging|reversible] [--tape f] [--max-steps N] [--dir -1]\n"
                 "                        [--rewind] [--mem addr]...\n");
    return 3;
}

}  // namespace

int main(int argc, char** argv) {
    const char* prog = nullptr;
    const char* tape = nullptr;
    rvm_kind kind = RVM_KIND_LOGGING;
    unsigned long long max_steps = 10000000ull;
    int dir = 1;
    bool rewind = false;
    std::vector<unsigned long> mems;

    for (int i = 1; i < argc; ++i) {
        const std::string a = argv[i];
        auto next = [&]() -> const char* { return i + 1 < argc ? argv[++i] : nullptr; };
        if (a == "--engine") {
            const char* v = next();
            if (!v) return usage();
            if (std::strcmp(v, "logging") == 0) kind = RVM_KIND_LOGGING;
            else if (std::strcmp(v, "reversible") == 0) kind = RVM_KIND_REVERSIBLE;
            else return usage();
        } else if (a == "--tape") {
            tape = next();
            if (!tape) return usage();
        } else if (a == "--max-steps") {
            const char* v = next();
            if (!v) return usage();
            max_steps = std::strtoull(v, nullptr, 0);
        } else if (a == "--dir") {
            const char* v = next();
            if (!v) return usage();
            dir = std::atoi(v);
        } else if (a == "--rewind") {
            rewind = true;
        } else if (a == "--mem") {
            const char* v = next();
            if (!v) return usage();
            mems.push_back(std::strtoul(v, nullptr, 0));
        } else if (!a.empty() && a[0] == '-') {
            return usage();
        } else if (!prog) {
            prog = argv[i];
        } else {
            return usage();
        }
    }
    if (!prog) return usage();

    std::vector<uint8_t> image;
    if (!read_file(prog, image)) {
        std::fprintf(stderr, "cannot read %s\n", prog);
        return 3;
    }
    rvm_t* vm = rvm_create(kind);
    if (!vm) return 3;
    if (rvm_load_program(vm, image.data(), image.size()) != RVM_OK) {
        std::fprintf(stderr, "load failed: %s\n", rvm_last_error(vm));
        rvm_destroy(vm);
        return 3;
    }
    if (tape) {
        std::vector<uint8_t> t;
        if (!read_file(tape, t) || rvm_set_input_tape(vm, t.data(), t.size()) != RVM_OK) {
            std::fprintf(stderr, "tape failed: %s\n", rvm_last_error(vm));
            rvm_destroy(vm);
            return 3;
        }
    }
    if (dir == -1 && rvm_set_direction(vm, -1) != RVM_OK) return 3;

    const Snapshot start = snapshot(vm);
    rvm_status s = RVM_OK;
    while (rvm_instruction_count(vm) < max_steps && (s = rvm_step_forward(vm)) == RVM_OK) {}
    int code = s == RVM_HALTED ? 0 : s == RVM_FAULT ? 1 : 2;

    uint32_t regs[16], pc;
    rvm_get_registers(vm, regs, &pc);
    std::printf("status %s\n", name(s));
    if (s == RVM_FAULT) std::printf("error %s\n", rvm_last_error(vm));
    std::printf("t %llu\npc %u\nhistory_bytes %zu\n", static_cast<unsigned long long>(rvm_instruction_count(vm)), pc,
                rvm_history_bytes(vm));
    for (int r = 0; r < 16; ++r) std::printf("r%d 0x%08x\n", r, regs[r]);
    for (unsigned long a : mems) {
        uint32_t w = 0;
        if (rvm_get_memory(vm, static_cast<uint32_t>(a), 1, &w) == RVM_OK) std::printf("mem 0x%lx 0x%08x\n", a, w);
        else std::printf("mem 0x%lx unmapped\n", a);
    }

    if (rewind) {
        const Snapshot end = snapshot(vm);
        const uint64_t end_t = rvm_instruction_count(vm);
        const rvm_status b = rvm_run_to(vm, 0);
        const bool back_ok = b == RVM_OK && snapshot(vm) == start;
        std::printf("rewind %s\n", back_ok ? "ok" : "MISMATCH");
        // and forward again: replaying must reproduce the end state
        const rvm_status f = rvm_run_to(vm, end_t);
        const bool replay_ok = (f == RVM_OK || f == RVM_HALTED) && snapshot(vm) == end;
        std::printf("replay %s\n", replay_ok ? "ok" : "MISMATCH");
        if (!back_ok || !replay_ok) code = 4;
    }
    rvm_destroy(vm);
    return code;
}
