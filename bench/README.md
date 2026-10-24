# bench/
Purpose: honest benchmarks: speed and history memory of the logging engine (diary) vs the reversible engine.
Owner: **core**.

- `bench.cpp` builds to `rvm_bench` (Release: `npm run build`, then `build/default/bench/rvm_bench --reps 9`).
- `RESULTS.md` has recorded numbers with the machine, compilers, spread and caveats.
- Planned: a conventional-vs-reversible comparison for the sort (instructions, code size, diary growth, garbage bytes).
