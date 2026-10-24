// VM-level benchmarks: speed and history memory of the logging VM (diary) vs the reversible VM (no history).
//   rvm_bench [--steps N] [--reps R]
// Prints a markdown report. Build in Release (npm run build) and run on an otherwise idle machine.
//
// What this measures, and what it does NOT:
//  - Both engines run the SAME program on the SAME instruction set, so this isolates the cost of the rewind
//    mechanism (a per-step diary versus recomputing inverses). It says nothing about how much a reversible
//    program costs compared with a conventional one (extra instructions, garbage); that needs a conventional
//    version of each program and is reported separately.
//  - Times are wall-clock medians over --reps runs after a warm-up, via the public C API (the same calls the
//    browser makes). Absolute numbers depend on this machine.
#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

#include "rvm/isa.h"
#include "rvm/program.h"
#include "vm_api.h"

namespace {

using clock_type = std::chrono::steady_clock;

// start: xori r1,K ; roli r1,S ; head: lnd ne r2,r0 <- back ; add r3,r1 ; addi r2,1 ; back: br ne r2,r1 -> head ; hlt
// Runs 2 + 4 * (K << S) instructions.
std::vector<uint8_t> counting_loop(uint32_t k, uint32_t s) {
    using rev::Op;
    rev::Program p;
    p.code = {
        rev::enc_r(Op::XORI, 1, 0, k),
        rev::enc_r(Op::ROLI, 1, 0, s),
        rev::enc_b(Op::LND, 2, 0, rev::kNe, 5),
        rev::enc_r(Op::ADD, 3, 1, 0),
        rev::enc_r(Op::ADDI, 2, 0, 1),
        rev::enc_b(Op::BR, 2, 1, rev::kNe, 2),
        rev::enc_r(Op::HLT, 0, 0, 0),
    };
    return rev::serialize_program(p);
}

uint64_t steps_for(uint32_t k, uint32_t s) { return 2 + 4ull * (static_cast<uint64_t>(k) << s); }

double seconds_since(clock_type::time_point t0) {
    return std::chrono::duration<double>(clock_type::now() - t0).count();
}

double median(std::vector<double> v) {
    std::sort(v.begin(), v.end());
    return v[v.size() / 2];
}

struct Result {
    double fwd_s = 0, back_s = 0;
    size_t history = 0;
};

Result run(rvm_kind kind, const std::vector<uint8_t>& image, uint64_t steps, int reps) {
    std::vector<double> fwd, back;
    size_t history = 0;
    for (int r = 0; r < reps + 1; ++r) {  // first rep is a warm-up
        rvm_t* vm = rvm_create(kind);
        if (!vm || rvm_load_program(vm, image.data(), image.size()) != RVM_OK) std::exit(2);
        auto t0 = clock_type::now();
        if (rvm_run_to(vm, steps) != RVM_OK) std::exit(3);
        const double f = seconds_since(t0);
        history = rvm_history_bytes(vm);
        t0 = clock_type::now();
        if (rvm_run_to(vm, 0) != RVM_OK) std::exit(4);
        const double b = seconds_since(t0);
        rvm_destroy(vm);
        if (r > 0) {
            fwd.push_back(f);
            back.push_back(b);
        }
    }
    return {median(fwd), median(back), history};
}

// Measured, not assumed: the logging engine's history after exactly 1000 steps, divided by 1000.
size_t diary_bytes_per_step() {
    const auto image = counting_loop(300, 0);
    rvm_t* vm = rvm_create(RVM_KIND_LOGGING);
    if (!vm || rvm_load_program(vm, image.data(), image.size()) != RVM_OK) std::exit(2);
    rvm_run_to(vm, 1000);
    const size_t per_step = rvm_history_bytes(vm) / 1000;
    rvm_destroy(vm);
    return per_step;
}

std::string human_bytes(double b) {
    const char* unit[] = {"B", "KiB", "MiB", "GiB"};
    int u = 0;
    while (b >= 1024 && u < 3) {
        b /= 1024;
        ++u;
    }
    char buf[32];
    std::snprintf(buf, sizeof buf, u == 0 ? "%.0f %s" : "%.1f %s", b, unit[u]);
    return buf;
}

}  // namespace

int main(int argc, char** argv) {
    uint64_t speed_steps = 2000000;
    int reps = 5;
    for (int i = 1; i + 1 < argc; i += 2) {
        if (std::string(argv[i]) == "--steps") speed_steps = std::strtoull(argv[i + 1], nullptr, 0);
        else if (std::string(argv[i]) == "--reps") reps = std::max(1, std::atoi(argv[i + 1]));
    }
    // Pick K, S so that 2 + 4 * (K << S) is close to the requested step count.
    auto shape = [](uint64_t target, uint32_t& k, uint32_t& s) {
        const uint64_t iters = std::max<uint64_t>(1, (target - 2) / 4);
        s = 0;
        while ((iters >> s) > 0x3FFFF) ++s;
        k = static_cast<uint32_t>(iters >> s);
    };

    std::printf("# VM benchmark\n\nrvm_version: %s\n\n", rvm_version());
    std::printf("Same program, same instruction set, two engines. Median of %d runs after a warm-up.\n\n", reps);

    // ---- speed ----
    uint32_t k, s;
    shape(speed_steps, k, s);
    const uint64_t steps = steps_for(k, s);
    const auto image = counting_loop(k, s);
    const Result lg = run(RVM_KIND_LOGGING, image, steps, reps);
    const Result rv = run(RVM_KIND_REVERSIBLE, image, steps, reps);
    std::printf("## Speed (%llu steps)\n\n", static_cast<unsigned long long>(steps));
    std::printf("| engine | forward | M steps/s | rewind to t=0 | M steps/s | history after run |\n|---|---|---|---|---|---|\n");
    auto row = [&](const char* name, const Result& r) {
        std::printf("| %s | %.1f ms | %.1f | %.1f ms | %.1f | %s |\n", name, r.fwd_s * 1e3, steps / r.fwd_s / 1e6,
                    r.back_s * 1e3, steps / r.back_s / 1e6, human_bytes(static_cast<double>(r.history)).c_str());
    };
    row("logging (diary)", lg);
    row("reversible (no history)", rv);
    std::printf("\nReversible / logging time: forward x%.2f, rewind x%.2f.\n\n", rv.fwd_s / lg.fwd_s, rv.back_s / lg.back_s);

    // ---- history growth ----
    std::printf("## History memory vs run length\n\n| steps | logging history | reversible history |\n|---|---|---|\n");
    for (uint64_t target : {1000ull, 10000ull, 100000ull, 1000000ull, 4000000ull}) {
        uint32_t kk, ss;
        shape(target, kk, ss);
        const uint64_t n = steps_for(kk, ss);
        const auto img = counting_loop(kk, ss);
        const Result a = run(RVM_KIND_LOGGING, img, n, 1);
        const Result b = run(RVM_KIND_REVERSIBLE, img, n, 1);
        std::printf("| %llu | %s | %s |\n", static_cast<unsigned long long>(n),
                    human_bytes(static_cast<double>(a.history)).c_str(), human_bytes(static_cast<double>(b.history)).c_str());
    }
    std::printf("\nHistory is the VM's own storage for rewinding. It does not include memory the program itself uses "
                "(garbage), which is identical on both engines for the same program.\n\n");
    std::printf("## Read this before quoting the numbers\n\n"
                "- The diary here is a straightforward implementation (%zu bytes per step, whatever the instruction\n"
                "  changes). A tighter diary would store less per step, which changes the constant but not the shape:\n"
                "  it still grows linearly with run length, while the reversible engine's history stays zero.\n"
                "- The reversible engine is faster going forward only because the diary engine pays to record every step.\n"
                "  Going backward it is slower: it recomputes each inverse instead of copying saved values back.\n"
                "  Rewinding trades memory for compute.\n"
                "- Both engines run the same program. The cost of writing programs reversibly (extra instructions,\n"
                "  garbage) is not measured here.\n"
                "- Single machine, wall-clock, one program shape (a tight counting loop). Numbers move with the CPU\n"
                "  and compiler; compare the engines to each other, not to other machines.\n",
                diary_bytes_per_step());
    return 0;
}
