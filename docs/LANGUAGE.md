# rev: a small reversible language

`rev` is a Janus-family language (Yokoyama and Glück, 1982 onwards) compiled to the reversible machine in this repo. Every
statement can be undone, so the compiler can write the inverse of any procedure (`uncall`) and the machine can run any
program backwards with no history. Janus and its successors (PISA, ROOPL) are prior art; what this adds is a compiler for
**this** machine, a cost report tied to SPEC section 12, and checks against the real engines.

```
var n = 10, i = 0, a = 0, b = 1;
out a, b;

proc step { a += b; a <=> b; }

main {
  from (i == 0) loop { call step; i += 1; } until (i == n);
}
```

```
npm run rvmc -- examples/rev/fib.rev --report       # compile, run on both engines, print the cost report
npm run rvmc -- prog.rev -o prog.rvm --asm prog.s    # write the image and the generated assembly
npm run test:lang                                    # 35 tests, run on the real engines
```

## The language
- **Variables** are 32-bit words. The first nine scalars live in registers `r1`..`r9`; further scalars live in data memory
  (the compiler handles that for you). `var x = 5, y;` declares them; `out x, y;` says which are the results (used by the
  garbage report).
- **Arrays** live in data memory: `var a[8] = {3, 1, 2};` (the rest zero). Elements are read and updated like variables:
  `x += a[i];  a[i + 1] ^= x;  a[i] <=> a[j];`. An index is any expression and is not bounds-checked. `var screen[2048] @ 0x20000;`
  places an array at an absolute address: that is how a program reaches the framebuffer (`0x20000`) or reads the input window
  (`0x30000`, read only). Memory is only ever changed by XOR or by moving a cell through a register, so nothing is overwritten.
- **Input**: `v ^= events;` (how many key events so far) and `v ^= latest;` (the most recent, or 0), only straight into a register
  variable (a key can arrive between any two instructions, so the compiler refuses to build input into an expression and take it
  out again: the second read could differ). Record it and clear `v` from the record: `log[i] ^= v; ... v ^= log[i];` as in
  `examples/demos/pong.rev`. They depend on machine time, so running such a program with direction -1 is not exact (step back is always exact), as for `examples/demos/pong.s`.
- **Printing**: `print "fib(", n, ") = ", hex a, "\n";` appends to the console (SPEC 11.9). Items are separated by commas: a string,
  or an expression with an optional format (`unsigned` is the default, then `signed`, `hex`, `char`). `'A'` is a character literal.
  The console is memory, so it un-prints when time goes backwards and when you `uncall` a procedure that printed, and the cost
  report counts it as garbage. About 13 machine instructions per character. `print`, `char`, `unsigned`, `signed` and `hex` are
  reserved words.
- **Statements** (there is no `=`; assignment would destroy the old value):
  `x += e;`  `x -= e;`  `x ^= e;`  (`e` must not mention `x`)  `x <=> y;`  `skip;`  `call p;`  `uncall p;`
- **Expressions**: constants (decimal, `0x`, `0b`), variables, `+ - ^ & |`, unary `~` and `-`, `rol(e, k)`. All 32-bit
  wrapping. There is no multiply or shift yet. Temporaries needed to evaluate `e` are built, used and then un-built, so
  nothing is left behind (Bennett's trick).
- **`if (test) { ... } else { ... }`** with an optional **`fi (assertion)`**. If you leave `fi` out, the compiler uses the test again, which
  is correct, and free, whenever neither branch (nor a procedure it calls) changes a variable the test reads and the test uses only
  registers and constants. If that is not so, it stops and says exactly why, and you write the `fi` yourself: a condition that is
  true if the `then` branch ran and false if the `else` branch ran, on the state *after* the branches (often a flag: that flag is
  the garbage the cost report counts). The report says how many `if`s had an inferred `fi` (nothing stored, nothing accumulating)
  and how many a written one. The compiler also **warns** about a written `fi` that probably cannot separate the branches: one that
  repeats the test after a branch changed what it reads, or one that reads only things no branch changes and is not the test.
- **`if (test) { ... } else { ... } fi (assertion);`** (the long form) The assertion must be true if the `then` branch ran and false if the
  `else` branch ran; it is what lets the machine know where it came from when run backwards.
- **`from (entry) do { S1 } loop { S2 } until (exit);`** The entry condition is true on the first pass and false on every
  later pass; the loop ends when `exit` is true. Both bodies are optional.
- **`proc p { ... }`** acts on the global variables; `uncall p` runs its inverse (the compiler generates it). No recursion yet.
- **Conditions** compare two variables, constants or array elements with `== != < > <= >=` (signed). In an `if` test an
  operand may be an array element; in an `fi` assertion and in a loop's `from`/`until`, operands must be register variables or
  constants (the machine tests them after the bodies have run). The machine tests `==`, `!=`, `<` and
  `>` directly and `<=`, `>=` only as false, so the compiler picks a layout that works (an `if` may cost two extra steps
  on one path). A loop's `from` condition must be testable as false: `==`, `!=`, `<=`, `>=`.
- Errors you will meet: a variable on both sides (`x += x + 1` is not reversible), plain `=`, unknown names, recursion, a
  loop `from` condition written with `<` or `>`.

## The cost report
`--report` compiles, runs the program on the logging engine (which checks every assertion), runs it on the reversible
engine, then undoes it step by step to t = 0 and replays it, and prints:
- machine instructions and steps, **per source line**; undoing a line costs the same number of inverse steps;
- initial and final values, and whether each non-output variable is `cleared`, an untouched `input`, or **GARBAGE**;
- the history the machine needed: 0 bytes (reversible) against the logging engine's 48 bytes a step (a naive diary, see
  spec section 12 and `bench/TWINS.md`);
- whether any temporary register was left non-zero (it would be a compiler bug) and whether the round trip was exact.

`out` is optional; without it garbage is not assessed. "Garbage" here is the SPEC 12.1 quantity: information the program
keeps because it cannot erase it. The report shows the significant bits next to the 32-bits-per-variable upper bound.

## How it is built
`src/parser.ts` (text to tree) -> `src/check.ts` (the reversibility rules) -> `src/codegen.ts` (tree to assembly text for
`asm/`, using `br`/`lnd` pairs and `call`/`proc`) -> the assembler (a second opinion: any assembler error on generated code is
reported as an internal error). `src/invert.ts` is the source-level inverse used by `uncall`. `src/report.ts` is the cost
report. `test/interp.ts` is a separate, direct interpreter of the language, used as the reference the compiled code is
compared against on both engines, forwards and backwards.

## What the language costs
Measured against hand-written assembly doing the same job (`examples/rev/sort8.rev`, 36 lines, against `examples/demos/sort.s`,
about 340 lines): 438 instructions and 335 steps against 341 and 311, with the same 14 bits of garbage. So the compiler costs
about 28 percent more code and 8 percent more steps than careful hand assembly on this program.

`examples/demos/pong.rev` against `examples/demos/pong.s` (about 240 lines of assembly). Measured when both played the same game with nothing
extra (the last commit before the wall and the score digits were added): 465 instructions against 275 and 488 steps a frame against
399, so +69 percent code and +22 percent steps. `pong.rev` has since gained a permanent wall and a score drawn as digits, which
`pong.s` does not have (it lights yellow blocks), so the two are no longer like for like: it is now 601 instructions and about 530
steps a frame, and that includes the extra drawing. What the test (`lang/test/pong.test.ts`) still checks on every frame of 250
frames of play is that the **court** (columns 0 to 31) is identical pixel for pixel to the hand-written game, that the wall never
changes, and that the digits equal the number of hits; and it runs forwards and backwards on both engines. Two programs; do not
extrapolate. The overhead comes from the compiler building every expression into temporaries and un-building it, and from moving
memory cells through registers to add to them.

## Not done yet
Recursion, multiply and shifts, a `logged` escape hatch with a cost report, a language server. See `docs/status/core.md`.
