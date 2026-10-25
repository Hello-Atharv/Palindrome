# Start here: a five-minute tour

**Palindrome is a computer where every instruction can be undone, so any program runs backwards with no history log.** Nothing is ever
overwritten, so the past is always recoverable from the present. This page is a guided tour of what you can do in this app, what it
shows, and what it costs. Everything here is measured; the limits are at the end.

## Try it in two minutes
Everything below happens in this app. The picker at the top right chooses the program.

1. **Play, lose, rewind.** Pick **pong** and press **Run forward**. Play with **W / S** or the arrow keys (keep the **Output** tab
   open). Miss the ball and the game halts. Now press **Run back**, or drag the time bar: the game rewinds exactly, score and screen
   included. Press a different key and carry on: you have started a new timeline.
2. **See what it costs.** Click **Compare engines** (top right), press **Run forward**, then **Measure both engines**. The left engine
   keeps a diary of every change and its history grows (48 bytes a step). The right one keeps **nothing**: 0 bytes. Both stay in exactly
   the same state.
3. **See the fair comparison.** In the same view open the **Benchmarks** tab. The diary on the left is deliberately naive. The honest
   opponents are here: a bit-packed diary and checkpoint-and-replay, each measured on a conventional version of the program.
4. **Read the cost per line.** Click **Back to the IDE**, pick **sort**, click **.rev** beside the file name, then **Build and load**.
   Under the editor is the **cost report**: steps per source line. Type a nonsense line and an error appears as you type.
5. **Watch it un-print.** Run the sort to the end. The Output tab prints the list before and after, and 19 flags. Press **Run back**: the
   text un-prints. Those 19 flags are the **garbage** the sort cannot erase (14 are set).
6. **Stop on a line.** Click in the narrow strip just left of a line number in the editor: a red dot appears. Press **Run forward** (or **Run
   back**) and the run stops the moment the machine reaches that line. Press Run again to carry on to the next time it gets there. Click the
   dot to remove it. Loading another program clears them.
7. **(Terminal) Ask "who last wrote this variable?"** Run `npm run demo`: a narrated debugger tour that answers by running time
   backwards. No log exists. See [the reference](REFERENCE.md) for every debugger command.

## How a program becomes a running machine
`rev` is the name of **our programming language**; a program in it is a `.rev` file (for example `examples/rev/fib.rev`). There is no
command called `rev`. Four steps turn it into something the machine runs, and each has a command:

| Step | You have | Command (from the repository root) | In this app |
|---|---|---|---|
| 1. Write | a `.rev` file | any editor | the code editor |
| 2. Compile | assembly (`.s`), the machine's instructions as text | `npm run rvmc -- prog.rev --asm prog.s` | the **.s** switch shows it |
| 3. Assemble | machine code (`.rvm`), 32-bit words | `npm run rvm -- build prog.rev -o prog.rvm` (steps 2 and 3 together) | **Build and load** |
| 4. Run | the machine, which you can run forward and back | `npm run rvm -- run prog.rev`, or `debug` for the debugger | the run buttons |

The machine has two engines for the same instructions, checked identical after every step: the **logging** one keeps a diary of every
change (our correctness oracle), and the **reversible** one keeps nothing and undoes a step by computing its inverse. The reversible one
is the point of the project.

## The numbers
| | sort of 8 | Pong |
|---|---|---|
| Instructions, reversible against an ordinary program | **3.0x** | **3.3x** |
| Memory held per frame: naive diary | n/a | 19,145 bytes |
| Memory held per frame: bit-packed diary | n/a | 126 bytes |
| Memory held per frame: checkpoints every 10,000 steps | n/a | about 15 bytes |
| Memory held per frame: **reversible** | the 19 flag words | **8 bytes** (its input log) |

So reversibility is a **trade**: about three times the instructions, in return for almost no memory held. It is not free, and a
bit-packed diary is faster. The method, and the caveats, are in [Benchmarks](../bench/TWINS.md).

## What it is not
- **Not a new idea.** Reversible computing goes back to Landauer (1961) and Bennett (1973); Janus is a reversible language from the 1980s.
  We built a complete, tested stack for it and measured it.
- **Not a proof.** The tests and `rvm verify` find violations; they do not prove there are none.
- **Not exact everywhere.** Stepping back in time is always exact. Running a program *as its own inverse* (direction -1) is exact only for
  programs that read no input.
- **Not fast.** It is a 32-bit toy machine with 19 instructions, no multiply and a 64 by 32 screen.

## Where to go next
- **Five more minutes:** [the writeup](WRITEUP.md): the story, what went wrong, what we learned.
- **Every idea from zero:** [the guide](GUIDE.md).
- **Everything it can do, with the commands:** [the reference](REFERENCE.md).
- **How the pieces fit:** [architecture](ARCHITECTURE.md).
