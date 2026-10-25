# The complete guide: what we built, how it works, and why

This is written for someone smart who has never touched reversible computing. No jargon without an explanation first. If a word is
new, it is in the glossary at the end. Read it top to bottom once; every section assumes only the ones before it.

---

## 1. The whole project in one minute

**Normal computers forget things. We built one that never forgets anything, so you can run any program backwards.**

Everything else is consequence:
- Because nothing is forgotten, "going back in time" is just running the program's steps in reverse. No saved history needed.
- Because the machine is unusual, we had to build the tools to program it: an assembler, a language, a compiler, a debugger.
- Because "it needs no history" sounds suspiciously good, we measured what it really costs, against fair opponents.

Theme of the hackathon: **time**. This is a computer where time can be run in both directions.

**An honest note up front.** None of the core idea is new. Reversible computing goes back to Landauer (1961) and Bennett (1973), and
reversible programming languages (Janus) go back to the 1980s. We did not invent it. What we built is a complete, tested, usable stack
for it, with honest measurements. Say that out loud before a judge does.

---

## 2. Paradigm 1: how normal computers work, and why they forget

A computer has **variables** (boxes holding numbers). The most basic instruction is "put this number in this box":

```
x = 5
```

Suppose `x` was 12 before. After this line, the 12 is **gone**. Nothing in the computer remembers it. This is called *overwriting*, and
it happens all over the place: `x = y`, storing into memory, almost everything.

Why this matters: **you cannot run `x = 5` backwards.** If I tell you "x is 5 now", you cannot tell me what it was before. Many
different earlier states lead to the same later state, so the information about which one it was has been destroyed.

An analogy: shuffling a deck of cards is reversible if you remember the shuffle. But if every shuffle also randomly throws away a card,
you can never get the original deck back.

### How people get time travel anyway: the diary
A "reverse debugger" lets you step backwards through a program. Since the machine forgets, the debugger has to **keep a diary**: every
time an instruction overwrites something, write down the old value. To go back one step, read the diary and put the old value back.

The diary works, but it costs memory that grows with every step the program runs. A program that runs a million steps needs a diary
with about a million entries. This is the baseline everyone uses (tools like `rr`, and "rollback netcode" in fighting games, which
saves snapshots of the whole game).

---

## 3. Paradigm 2: reversible computing: never throw anything away

The idea: design the machine so **every instruction can be undone exactly**, using only the machine's current state. Then there is
nothing to write in a diary, because the machine can always work out what it was.

The mathematical word is **bijection**: a one-to-one, reversible mapping. Every state before leads to exactly one state after, and
every state after came from exactly one state before.

Analogy: **a Rubik's cube.** Every move has an exact undo move (turn the same face the other way). You never need a diary of what you
did; if I hand you the scrambled cube and tell you the last move, you can undo it. Our machine is a Rubik's cube whose moves are
instructions.

### The one rule that makes it possible: never overwrite, only update in place
- **Not allowed:** `x = 5` (destroys the old x).
- **Allowed:** `x += 5` ("add 5 to x"). Reversible: to undo, subtract 5. No information lost.
- **Also allowed:** `x ^= y` (XOR). Reversible too: doing it twice cancels out, so it is its own undo.

The principle is the same for both: **change a value by combining it with something, using an operation you can undo, and never
discard the old value.** To **copy** a value without overwriting, combine it into a box that is zero (`0 + y = y`, and `0 ^ y = y`).
To **clear** a copy later, undo what you did.

**XOR is not special.** Add would do almost everything XOR does here. We use XOR for memory writes, drawing pixels and the logic
gates mostly by convention (it is its own undo, so one instruction covers both directions, and it is the textbook form of the
reversible gates). Its few real advantages: it can flip a chosen bit without knowing the bit's current state, and it never carries
into neighbouring bits. Everything in this project is built from "update in place with something undoable" and "swap two things".

One rule you will see: you can't do `x += x` (add a thing to itself). Why? Because `x + x` doubles it, and doubling loses the top bit
(two different starting values can double to the same result), so it is not reversible. The assembler refuses it.

---

## 4. Our machine (the "reversible computer")

A tiny processor, defined in `spec/SPEC.md`:
- **Registers:** 16 boxes (`r0`..`r15`) holding 32-bit numbers. `r14` is the stack pointer; we keep `r0` as zero by habit.
- **Memory:** a big array of 32-bit words. The special regions: data (where programs keep things), a stack, a **64x32 pixel
  screen** (memory that the web page draws), and a read-only **input window** (where key presses show up).
- **19 instructions**, every one reversible:

| Group | Instructions | In plain words |
|---|---|---|
| Arithmetic in place | `add`, `sub`, `addi` | `ra += rb`, `ra -= rb`, `ra += constant` |
| Bit tricks | `xor`, `xori`, `not`, `roli` | xor, flip all bits, rotate the bits around the end |
| Swapping | `swap` | exchange two registers (nothing lost) |
| Memory | `xld`, `xst` | **xor** a memory word into a register / xor a register into memory. Memory is never overwritten, only xored |
| Logic gates | `cswap`, `toff` | "swap if this is non-zero" and "xor in the AND of two things": the famous reversible gates of Fredkin and Toffoli |
| Control | `br`, `lnd`, `call`, `proc`, `ret`, `hlt`, `nop` | jumps, landing markers, procedure calls (explained in section 6) |

**Why memory is xor-only:** writing a word normally overwrites it. Instead (and by convention: an add-based memory would also work), to put a value `v` into a zeroed memory word you xor it in;
to *move* a word into a register you do `xld` then `xst` (which leaves the memory word zero and the value in the register). We call this
the **move idiom**, and the compiler uses it constantly.

**"Undo" is a real operation:** the machine can compute, from the current state alone, the state one step ago. That is `step_back`.

---

## 5. Two engines: the "oracle" and the real thing

We built the machine **twice**, behind the same interface:

1. **The logging engine** (the "diary engine"). Runs instructions normally and writes a diary entry for every change (48 bytes per
   step, a deliberately simple format). It is the **oracle**: a slow, obviously-correct reference.
2. **The reversible engine.** Keeps **no** diary. To step back it computes the inverse of the previous instruction.

Why two? **To check ourselves.** Both must produce the exact same state after every action: step, step back, jump to time T, and so
on. We wrote tests that do thousands of random jumps forwards and backwards and compare the two engines after each one
(`vm/tests/differential_test.cpp`). If we break an instruction's undo on purpose, the tests catch it (we did this deliberately; it is
called a *mutation check*).

The engines are written in C++ for speed, and also compiled to **WebAssembly** so the very same code runs in the browser.

---

## 6. Control flow: the hardest idea in the project (jumps)

Straight-line code is easy to reverse. **Jumps** are the problem.

Picture a junction where two roads meet. You arrive at the junction. To walk backwards, you need to know **which road you came
from**. A normal computer doesn't record that, which is another reason it can't go backwards.

Our fix, from the research literature: every place where two paths join must be marked, and the program has to **declare, in
advance, a condition that tells the paths apart**.

- `br` is a branch ("jump if a condition holds").
- `lnd` is a **landing**. It sits at the place you land after a jump. It carries an *assertion*: "a certain condition is true here
  **if and only if** we arrived by that jump".

Example (`if`/`else`):
```
if x == y then  A  else  B  end          <- two paths merge afterwards
```
At the merge point the program says "if `x != y` here, we came from the else side". Going backwards, the machine just checks that
condition and walks back along the right road. **The programmer has to supply a condition that really does tell the branches apart**
(that is the `fi (...)` part you see in the language). If they lie, the **logging engine catches it** ("landing assertion failed") but
the reversible engine, which has no history to check against, would just go wrong. That's one reason the logging engine exists.

**Procedures** (`call`/`proc`/`ret`) work the same way: the return address is stored by xor and cleared again on return, so the stack
is clean afterwards.

---

## 7. Garbage: what a reversible program is forced to keep

Here's the catch. If nothing may be destroyed, what about computations that *naturally* destroy information?

**Sorting.** `[3,1,2]` and `[1,2,3]` both sort to `[1,2,3]`. A normal sort throws away which order you started in. A reversible sort
can't, so it has to **keep a note** of what it did. In our sort, every compare-and-swap step writes one bit: "did I swap?". Those
bits are called **garbage**: information the program keeps *only because it cannot erase it*.

Our sort shows its garbage on screen (row 1 of the screen). Sorted list **plus** garbage equals the original list, so run
backwards it un-sorts exactly. We checked: the theoretical minimum for sorting 8 different numbers is about 15.3 bits of garbage, and
ours keeps at most 19.

### Bennett's trick (compute, copy, uncompute)
How do you get a *result* without leaving a trail of garbage behind? 1973 trick: compute the answer using temporary scratch space,
**copy the answer out**, then **run the computation backwards** to clean the scratch space back to zero. The compiler does this for
every expression you write: build the value in temporary registers, use it, then undo the build. Thousands of times per program.

### The one thing that must be recorded: input
If the program reads a key press, that comes from outside the machine and isn't derivable from anything. To replay a game exactly you
must record the key presses. Pong keeps a log of them (8 bytes per frame). That log is Pong's *only* real garbage.

---

## 8. Time, direction, and a trap

Two different ways to go backwards, easy to confuse:

- **Step back** (`stepBack`, the scrubber, "Back" button): go to the exact previous state. **Always exact**, even for programs that
  read key presses (the machine knows the key press history in the input tape).
- **Direction -1** ("run the program as its own inverse"): run the *same program text* backwards. This is how the cipher decrypts: you
  run the encryption backwards. It's exact **only for programs that read no input**, because the input window depends on machine time.

---

## 9. Paradigm 3: the programming language, `rev`

Writing 19-instruction assembly by hand is painful, so we made a language (`lang/`). It is in the **Janus family** (1980s reversible
language), compiled to our machine.

What it looks like:
```
var n = 10, i = 0, a = 0, b = 1;
proc step { a += b; a <=> b; }
main { from (i == 0) loop { call step; i += 1; } until (i == n); }
```

The rules that make it reversible, and what they feel like:
- **No `=`**. Only `+=`, `-=`, `^=` and `<=>` (swap). The right-hand side can't mention the variable being changed (`x += x` is
  rejected).
- **`if (test) {..} else {..} fi (assertion)`**: the `fi` part is the "landing assertion" from section 6, written by the programmer.
- **`from (entry) do {..} loop {..} until (exit)`**: a loop with a condition that's true on the first pass only.
- **`uncall p`**: runs the procedure *backwards*. The compiler writes the inverse procedure for you.
- **Arrays**, variables in memory, `@ 0x20000` to place an array on the screen (so `screen[i] ^= colour` draws), and `events`/`latest`
  to read keys.

How the compiler works (`lang/src/`): parse text into a tree, **check** the reversibility rules (rejects things that would leave
garbage), **generate** assembly using the branch/landing patterns, run it through the assembler (a second opinion). Every expression is
built in temporary registers and then un-built (Bennett's trick).

**The cost report** is the project's signature feature. For every source line it tells you: how many machine steps it costs, which
variables end up as garbage, how many bytes of history the machine needed (0), and whether running the whole program backwards and
forwards again reproduced the identical states.

---

## 10. The tools around it

| Tool | Where | What it does |
|---|---|---|
| Assembler | `asm/` | Turns `.s` text into machine code. Has macros (`.if`, loops, temporaries where the assembler writes the undo for you). Rejects control flow that wouldn't be reversible. |
| Compiler | `lang/` | `rev` to assembly, plus the cost report. |
| `rvm` command | `cli/` | `build`, `run`, `report`, `verify`, `debug`. |
| Debugger | `cli/src/debugger.ts` | Steps **back** by source line. `rwatch x` runs time backwards until `x` changes: "who last wrote this?" That's a showpiece. |
| `rvm verify` | `cli/src/verify.ts` | Runs a program on both engines, checks they agree after every step, does 200 random time jumps, checks exact undo and replay. Says honestly: this is testing, not proof. |
| Browser UI | `web/viz` | The real engines in a browser: play Pong, scrub time, compare engines, live `rev` editor with errors as you type and the cost report. (`npm run viz`) |
| VS Code extension | `vscode/` | Colours, error underlines, and the cost shown beside each line. |

---

## 11. The demo programs

- **Speck cipher** (`examples/demos/cipher.s`): a real encryption algorithm. Decrypt = run it backwards. We checked it against the
  published test vector.
- **Sort** (`examples/demos/sort.s`): shows its garbage on screen.
- **Pong** (`examples/demos/pong.s` in assembly, `examples/demos/pong.rev` in the language). Playable. Rewind and the whole game rewinds,
  including your key presses. The ball has no bounce code: it's a "triangle wave" (position folds back at the edges), so a bounce is
  just the fold turning round and nothing is decided or lost. Drawing is XOR, so the same line draws and erases.
  `pong.rev` also has a **permanent wall** and a score shown as digits.

---

## 12. How we know it works (and what we don't know)

- **About 430 automated tests** across the C++ engines (3 test programs), assembler (87), browser engine (95), language/compiler (73), command line (21),
  benchmark baselines (9), VS Code extension (9), browser UI (85) and its mock VM (55).
- **Two engines compared after every action**, including random time jumps.
- **A separate interpreter of the language** (`lang/test/interp.ts`) as an independent reference for the compiler.
- **Mutation checks:** we deliberately broke code (an instruction's undo, a compiler layout) and confirmed tests failed.
- **Cross-checking programs:** `pong.rev` vs hand-written `pong.s`, frame by frame, pixel by pixel (court), 250 frames.

**What is NOT established:**
- Testing is not proof. `rvm verify` finds violations; it can't prove there are none.
- The VS Code extension's editor glue has never been run in a real VS Code window (everything it calls is tested).
- Pong has never been hand-played with a real keyboard by us end to end (the keyboard-scroll fix is untested in a browser).
- All measurements are on a toy machine with a few programs. Don't extrapolate.

---

## 13. The benchmark: what does being reversible actually cost?

Our first benchmark was misleading: the logging engine's diary costs 48 bytes per step, so "reversible: 0 bytes vs diary: 48 bytes
per step" looked like a landslide. But 48 bytes is a *lazy* diary. A fair test needs real opponents, so we built them
(`bench/twins`):

- **Conventional twins**: the sort and Pong rewritten for a normal overwriting machine, drawing identical pictures.
- **Tight diary**: a clever, bit-packed history that rewinds exactly.
- **Checkpointing**: save a snapshot every K steps; to go back, restore the nearest snapshot and replay forwards.

Results for Pong (per frame of gameplay):

| Strategy | Memory per frame | To go back |
|---|---|---|
| Naive diary (our logging engine) | 19,145 bytes | 1 step |
| Tight diary | 126 bytes | 1 step |
| Checkpoint every 10,000 steps | ~15 bytes | up to 10,000 steps of replay |
| **Reversible** | **8 bytes** (its input log; 0 in the machine) | 1 step |

**How to read it honestly:** reversible beats the naive and tight diaries on memory; it is *about level* with checkpointing on memory,
and checkpointing jumps to a far-away time faster. Pong has a tiny state, which suits checkpointing; a program with a huge state
would favour reversible, but **we did not measure that**.

**The price:** reversible programs run **about 3x the instructions** of their conventional twins (sort 3.0x, Pong 3.3x), because you
can't overwrite: you copy, compute, and uncompute.

**The compiler's price:** the same sort in `rev` costs 28% more code and 8% more steps than hand-written assembly. (Pong: +69% code,
+22% steps measured before we added the wall and digits; it's no longer a like-for-like comparison.)

**One-line takeaway:** we did not make undoing free; we made its cost impossible to hide.

---

## 14. Bugs we hit (a sign the testing works)

- **Step-by-frame:** `frame += 1` on memory passes through zero halfway through its update, so "wait until it changes" stops at the
  wrong moment. The spec now says "wait for plus one".
- **Compiler: constants held across calls.** Constants used by an `if`/loop condition sat in registers while the body ran, and a
  procedure called inside used those registers assuming they were zero. This crashed Pong's first score. Fixed; regression tests
  added.
- **Grammar:** the VS Code colouring missed the `call` keyword because one rule swallowed it first.
- **Our own benchmark was flattering** until we built fair opponents.

---

## 15. What we claim, and what we don't

**We claim:** a complete, tested, open, browser-based toolchain for a reversible machine, with a time-travel debugger, a language with
a per-line cost report, and a measured comparison against conventional ways of going back in time.

**We do not claim:** that reversible computing, reverse debugging, or rollback were invented here; that reversible beats
checkpointing; that the numbers generalise.

Prior art to name: Landauer (1961), Bennett (1973), Janus, PISA/Pendulum, ROOPL, BobISA, GGPO (rollback netcode), and for the
cipher, Speck.

---

## 16. What's left

Done since this was first written: the benchmark chart, the browser UI with a live `rev` editor, the input-race fix, the console. Still to do:
a full demo rehearsal and a final read of the writeup. Maybe: shrinking compiler overhead. Not planned: more demos, language features or a
showpiece.

---

## 17. Glossary

- **Bijection:** a one-to-one reversible mapping; the maths word for "can be undone exactly".
- **Reversible instruction:** one whose result lets you recover its input.
- **Garbage:** information a reversible program must keep because it cannot erase it.
- **Bennett's trick:** compute, copy the answer, then uncompute to clear the scratch work.
- **XOR (`^`):** a bit operation that is its own undo (doing it twice cancels).
- **Move idiom:** `xld` then `xst`: move a memory word into a register, leaving the memory zero.
- **Oracle:** a trusted reference implementation used to check another one. Ours is the logging engine.
- **Differential testing:** running two implementations on the same inputs and comparing every result.
- **Mutation check:** breaking the code on purpose to confirm the tests notice.
- **Diary (logging):** a history of overwritten values kept so you can undo.
- **Tight diary:** a compact, real, working diary (a fair benchmark opponent).
- **Checkpoint-and-replay:** snapshots every K steps; to rewind, restore and replay forward.
- **Landing assertion (`lnd`, `fi`):** a condition declared at a join that tells you which path you arrived by.
- **Step back vs direction -1:** exact previous state vs running the program text backwards (exact only without input).
- **Cost report:** the compiler's per-line account of steps, garbage and history.
- **WASM (WebAssembly):** a way to run compiled C++ in the browser.
- **Janus:** a 1980s reversible programming language; our `rev` is in its family.
- **Landauer's principle:** erasing information has a minimum energy cost; the reason reversible computing was proposed.

---

## 18. Where everything is

```
spec/        the contract: instructions, memory map, cost model (SPEC.md section 12), formats, CHANGELOG.md
vm/          the two C++ engines (logging + reversible), their tests in vm/tests/, the WebAssembly build
asm/         the assembler                                     lang/       the rev compiler + cost report
cli/         the rvm command, debugger, verify                 vscode/     the editor extension
web/wasm/    the engines in the browser (WebAssembly)         bench/      benchmarks and the fair twins
examples/    every runnable program: asm/ (teaching), rev/ (the language), demos/ (cipher, sort, Pong)
docs/        all the written material: this guide, ARCHITECTURE, LANGUAGE, DEMO, WRITEUP, hackathon/, status/
```
Run everything: `npm run setup`, `npm run build`, `npm run test:all`. Try it: `npm run viz`.
