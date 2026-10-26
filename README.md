# Palindrome: a computer that can't forget

**OxHack 2026 runner-up.**

OxHack 2026, theme **time**. A small computer in which every instruction can be undone, so any program runs backwards with
no history log, plus the whole toolchain around it: an assembler, a language and compiler, a debugger that steps *back*, a
verifier, a browser UI, a VS Code extension, and a benchmark that compares the price of undoing against the usual ways.

Reversible computing is old (Landauer, Bennett, Janus, Pendulum). We did not invent it; we built a complete, tested stack for it
and measured it honestly. See "What this is not" below.

**See it now:** https://reversible-machine.vercel.app (pick `pong`, press Run, lose, then step back). Short on time? Click **Tour** at the top of the app, or read [docs/TOUR.md](docs/TOUR.md): five minutes. Every command and feature is listed in [docs/REFERENCE.md](docs/REFERENCE.md), and all the documentation is also inside the app, in the **Docs** tab.

## Try it in two minutes
```
npm run setup              # install the JavaScript parts (once)
npm run rvm -- debug examples/rev/sort3.rev --script "s; s; s; p; rwatch f1; b; b"
```
That compiles a sort written in `rev`, runs it, then runs it **backwards** to the line that last wrote `f1`, and steps back to the start
(the machine keeps 0 bytes of history for any of it). Nothing here needs a C++ compiler: the engines ship as WebAssembly. Other things to try:
```
npm run rvm -- report examples/demos/pong.rev     # what every source line of Pong costs, and the garbage it keeps
npm run rvm -- verify examples/demos/pong.rev     # both engines, 200 random time jumps, exact undo, direction -1
npm run demo                                # the narrated debugger tour: press Enter through it (step back, who last wrote this variable, 0 bytes of history)
npm run viz                                 # the browser UI: play Pong, scrub time, edit rev live, compare engines
npm run build                               # the C++ engines, only for the C++ tests (needs CMake and a C++17 compiler)
npm run test:all                            # engines, assembler, compiler, CLI, extension, benchmarks (about 300 tests, about a minute)
npm run check                               # test:all plus the browser UI and its mock VM (run this before every push)
```

## What is in the box
| | where | what |
|---|---|---|
| The machine | `spec/`, `vm/` | 19 instructions, each a bijection on the machine state. Two engines behind one interface: a **logging engine** (keeps a diary of every change; the correctness oracle) and a **reversible engine** (keeps nothing; steps back by computing inverses). They are checked identical after every step by differential tests. |
| Assembler | `asm/` | TypeScript, runs in Node and the browser. Macros for `if`, loops, temporaries (the assembler writes the undo), drawing. Checks the control-flow rules that make branches reversible. |
| Language | `lang/` | `rev`, a Janus-family reversible language compiled to the machine: arrays, input, the screen, procedures with `uncall`, and a **cost report** per source line. |
| Command line | `cli/` | `rvm build / run / report / verify / debug`. The debugger steps back by source line, has breakpoints, and answers "who last wrote this variable?" by running time backwards. |
| Browser | `web/wasm/` | The same C++ engines compiled to WebAssembly. The browser UI is `web/viz`: a live `rev` editor with the cost report, a compare-engines view, keyboard-playable Pong. |
| Editor | `vscode/` | Syntax colouring, diagnostics, and the cost shown beside each line. |
| Demos | `examples/demos/` | A Speck64/128 cipher (decrypt = run backwards), a sort that exposes its garbage, and Pong, in assembly and in `rev`. |
| Measurements | `bench/` | Speed of both engines, and **conventional twins** of the sort and Pong against which the price of undoing is measured. |

## The numbers (all measured; `bench/TWINS.md` has the method and the caveats)
- **The machine needs no history.** Rewinding the reversible engine costs 0 bytes per step. Our logging engine's diary costs 48 bytes a
  step; that is a naive diary, so the fair comparison is below.
- **Reversible code costs more steps.** The same sort takes 3.0 times the instructions of its conventional twin, Pong 3.3 times (measured on the hand-written assembly programs `examples/demos/sort.s` and `pong.s`).
  That overhead is real and is the price.
- **Against a fair diary** (a real bit-packed history of the conventional twin, which rewinds exactly): Pong needs about 126 bytes a frame,
  the reversible program about 8 (its input log). Against checkpoint-and-replay (a snapshot every 10,000 steps, about 15 bytes a frame
  here) the memory is comparable, and checkpointing seeks to a far-away time faster; the reversible machine steps back one instruction in
  one step and loses nothing between snapshots. Pong has a tiny state; a program with a large one would favour reversible. Not measured.
- **The language costs about 8 to 22 percent more steps than hand-written assembly** (the same sort, and an earlier Pong written both ways
  producing the identical picture on every frame; the rev Pong has since gained a wall and score digits, see `lang/README.md`), at about
  30 to 70 percent more instructions of code.
- **Garbage is visible.** The sort keeps at most 19 bits (14 this time) against a floor of 15.3 for sorting 8 distinct numbers.

## What this is not
- Not a new idea. Janus (1982), PISA and Pendulum, ROOPL, BobISA and others did reversible languages and machines; reversible-debugging
  and rollback netcode (GGPO) are also established. We found no existing open, browser-based, verified toolchain for a reversible ISA with a
  time-travel debugger and a measured comparison against conventional rewind, which is what this is.
- Not a proof. `rvm verify` and the tests find violations; they do not prove their absence.
- Not exact everywhere. Running a program **backwards by direction** (`direction -1`) is exact only for programs that read no input; stepping
  back in time is always exact.
- Not fast. It is a 32-bit toy machine with 19 instructions, no multiply, and a 64 by 32 screen.

## Layout and rules
One owner per directory; see `CLAUDE.md` for roles, `spec/SPEC.md` (the contract, including the cost model in section 12) and
`spec/CHANGELOG.md`. Each person keeps a status file in `docs/status/`. All the written material is in `docs/` (index: `docs/README.md`): the demo script is `docs/DEMO.md`, the writeup `docs/WRITEUP.md`. **New to all this? Start with `docs/GUIDE.md`** (and `docs/ARCHITECTURE.md` for how the pieces fit), which explains every idea from zero.
