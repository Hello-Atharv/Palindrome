# We built a computer that can't forget (and then measured whether that was a good idea)

## The idea, in one paragraph
Every computer you have used forgets. When it runs `x = 5` it throws away whatever `x` was. That is why you cannot run a program
backwards, and why a debugger that wants to step back has to keep a diary of everything the program overwrote. We built a machine
in which no instruction is allowed to throw anything away. Add becomes "add in place", copy becomes "xor into a zero", and every step
has an exact inverse. So to go back in time you do not read a diary; you just run the instructions' inverses.

None of this is new. Landauer pointed out in 1961 that forgetting costs energy, Bennett showed in 1973 that you can compute without
forgetting, and Janus, Pendulum and friends have been writing reversible programs since the 1980s. The theme was time and we wanted to
touch it, so we did not invent anything; we built all of it and tested it hard.

## What we built
- A machine with 19 instructions, each a bijection on the whole machine state, and **two engines** for it: one that keeps a diary
  (the oracle) and one that keeps nothing. We check them against each other after every action, including random jumps back and forth in
  time. When we deliberately broke the inverse of an instruction, the checks caught it.
- An assembler, a **language** (`rev`, in the Janus family) with a compiler for it, a **debugger** that steps back by source line and
  can answer "who last wrote this variable?" by running time backwards, a **verifier**, a browser playground with a live editor, and a
  VS Code extension that shows the cost beside each line.
- Three programs that stress it: a real cipher (Speck64/128, decrypting by running it backwards), a sort that shows the garbage it cannot
  erase, and Pong, which you can play and then rewind exactly, keypresses and all. Pong exists twice: by hand in assembly and in `rev`, and
  the two draw the identical picture on every frame.

## The part where we tell you what it costs
The first benchmark was flattering and wrong. Our logging engine's diary costs 48 bytes a step, so "0 bytes against 48 bytes a step"
looks like a victory. It is a victory over our own lazy diary. So we built the fair opponents:

- **Conventional twins** of the sort and Pong, written for an ordinary overwriting machine, drawing the same pictures.
- A **tight diary** for them: a real bit-packed history that rewinds exactly, storing only the old value's significant bits.
- **Checkpoint and replay**: a snapshot every K steps, the way a lot of real rollback works.

What came out, for Pong (200 frames, a paddle that chases the ball):

| | memory kept, per frame | cost to go back |
|---|---|---|
| naive diary (our logging engine) | 19,145 bytes | one step per step |
| tight diary | 126 bytes | one step per step |
| checkpoint every 10,000 steps | 15 bytes | up to 10,000 steps of replay |
| **reversible** | **8 bytes** (its input log; 0 in the machine) | one step per step |

So reversible is far ahead of the naive diary, well ahead of the tight diary, and roughly level with checkpointing on memory while
checkpointing is faster at jumping to a far-away time. Pong has a tiny state, which suits checkpointing. We did not measure a program with a
large state, where we would expect reversible to look better. And the price: the reversible programs run **3.0 to 3.3 times** the
instructions of their conventional twins, because you cannot overwrite and so you copy, compute and uncompute. We think that is an honest
result: reversibility is a trade, not a free lunch.

## The language, and what it costs
`rev` programs are much shorter than the assembly (Pong is about 100 lines against 240; the sort is 36 lines against 340). The compiler builds every expression into temporary registers, uses
it, and runs the build backwards so nothing is left behind (Bennett's trick, applied thousands of times). On the same sort the result is
within 28 percent of our hand-written assembly in code size and 8 percent in steps; on Pong, 69 percent more code and 22 percent more steps.
Two programs, so do not extrapolate. The report that comes with every compile says which source lines cost what, which variables end
up as garbage, and that the whole run was undone and replayed to the identical state.

## Things that went wrong, because you will want to know
- We did not trust the sort until its network had been checked on all 256 inputs of zeros and ones (the 0-1 principle) and the program on 25 random inputs, duplicates included.
- The first cipher barely diffused. We replaced it with real Speck and checked it against the published test vector.
- `frame += 1` on a memory cell goes through zero halfway through its own update, which broke "step by frame" in the debugger until a test
  caught it. The spec now says "wait for plus one", not "wait for a change".
- Running a program **backwards by direction** is not exact when it reads input, because the input window follows machine time. Stepping
  back in time is always exact. We say so in the spec and in the tool output rather than hiding it.
- The editor extension's glue code has not been run inside a real VS Code window; everything it calls is tested.

## Why we think it was worth doing
Time travel in a debugger is usually sold as magic and priced as a diary. Here the price is visible at every layer: in the spec (section 12
defines what is counted), in the compiler (every line shows its steps and its garbage), in the debugger (it reports history bytes), and in
the benchmark (with opponents that fight back). If you want one sentence: **we did not make undoing free, we made its cost impossible to
hide.**

## Credits and prior art
Landauer (1961), Bennett (1973), Janus (Lutz and Derby 1982, Yokoyama and Glück 2007), PISA and Pendulum (Vieri), ROOPL, BobISA, GGPO
(rollback netcode), Speck (Beaulieu et al., NSA), sorting networks for eight inputs (Batcher and successors).
