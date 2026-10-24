# bench/
Purpose: honest benchmarks: speed and history memory of the logging engine (diary) vs the reversible engine.
Owner: **core**.

- `bench.cpp` builds to `rvm_bench` (Release: `npm run build`, then `build/default/bench/rvm_bench --reps 9`).
- `RESULTS.md` has recorded numbers with the machine, compilers, spread and caveats.
- Planned: a conventional-vs-reversible comparison for the sort (instructions, code size, diary growth, garbage bytes).

## Fair baselines (conventional twins)
`bench/twins/` runs conventional twins of the sort and Pong next to the reversible programs and compares memory held and time to
undo against a naive diary, a tight diary and checkpoint-and-replay. `npm run test:twins` checks the twins and the exact rewind;
`npm run bench:twins` regenerates `bench/TWINS.md`. Definitions: SPEC section 12.
