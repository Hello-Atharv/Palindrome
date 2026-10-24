# Benchmark results (VM level)

Run with `build/default/bench/rvm_bench --reps 9` (Release). Same program on both engines (a tight counting loop,
about 2.0 million instructions), through the public C API. Method and caveats are printed by the tool itself.

Machine: Intel Core Ultra 7 155H (16 cores), 16 GB, Windows 11. Laptop, so absolute times drift between runs.
Compilers: GCC 13.2 (MinGW/Strawberry) and MSVC 19.29 (VS 2019), both Release.
Recorded 2026-10-24 (three runs per compiler).

## What is stable: history and ratios

| | logging engine (diary) | reversible engine |
|---|---|---|
| history per step | 48 bytes, exactly (measured) | 0 bytes |
| history after 1 M steps | 45.8 MiB | 0 B |
| history after 4 M steps | 183.1 MiB | 0 B |
| forward time vs diary | 1.0x | about 0.2x (about 5x faster) |
| rewind-to-start time vs diary | 1.0x | about 2.2x to 3.1x slower with GCC, about 4.8x to 5.5x with MSVC |

## Absolute times for 1,999,994 steps (min to max over the three runs)

| compiler | engine | forward | rewind to t=0 |
|---|---|---|---|
| GCC | logging (diary) | 49 to 77 ms (26 to 40 M steps/s) | 5.5 to 7.3 ms |
| GCC | reversible | 10 to 18 ms (114 to 200 M steps/s) | 12 to 23 ms |
| MSVC | logging (diary) | 131 to 179 ms (11 to 15 M steps/s) | 9.6 to 11.6 ms |
| MSVC | reversible | 28 to 39 ms (51 to 71 M steps/s) | 41 to 57 ms |

The same C++ compiled to WebAssembly (Node, wasm build): 200,001 steps forward in about 5 ms and back in about 5 ms
on the reversible engine, with 0 bytes of history (`web/wasm`, test "rewinds a long run exactly").

## How to read this honestly
- The headline: **rewinding costs the reversible engine no history memory, while the diary grows 48 bytes per step.**
  After 4 million steps that is 183 MiB against zero.
- The cost: **rewinding is slower** (about 2 to 5 times, depending on compiler), because each step is undone by
  recomputing its inverse instead of copying saved values back. We trade memory for compute.
- Going forward the reversible engine is faster only because the diary engine pays to record every step.
- The 48 bytes per step is our straightforward diary. A tighter diary would store less per step; it would still grow
  linearly. Do not quote 48 as "what a diary must cost".
- Reversible-versus-conventional program costs (extra instructions, garbage, fair diaries, checkpointing) are in `bench/TWINS.md`.
  Read that file before quoting the 48 bytes per step above as a comparison.
- The MSVC and GCC differences are compiler code generation on this machine, not a property of the design.

## A real program: Pong (`programs/pong.s`)
Measured by `web/wasm/test/pong.test.ts` (200 frames, a paddle that chases the ball, 105 key events):
- about **400 steps per frame** (275 instructions of code);
- diary engine history **19,145 bytes per frame** (48 bytes x 399 steps), reversible engine history **0**;
- the program's own garbage is its input log: **8 bytes per frame** (two words), and the words are zero while nobody presses a key.
An earlier version of the same game, written without the new macros, was 487 instructions and about 300 steps per frame (14,413 bytes
of diary history per frame): smaller code costs more steps per frame here.
Caveats: the diary figure is our straightforward 48-byte-per-step diary (a tighter one would be smaller but still linear); the reversible
program's extra instructions compared with a conventional Pong are measured in `bench/TWINS.md` (about 3.3x).
