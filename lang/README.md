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
npm run rvmc -- lang/examples/fib.rev --report       # compile, run on both engines, print the cost report
npm run rvmc -- prog.rev -o prog.rvm --asm prog.s    # write the image and the generated assembly
npm run test:lang                                    # 23 tests, run on the real engines
```

## The language
- **Variables** are 32-bit words kept in registers `r1`..`r9` (nine at most; memory variables are not supported yet).
  `var x = 5, y;` declares them, initial values are constants. `out x, y;` says which variables are the program's results
  (used by the garbage report).
- **Statements** (there is no `=`; assignment would destroy the old value):
  `x += e;`  `x -= e;`  `x ^= e;`  (`e` must not mention `x`)  `x <=> y;`  `skip;`  `call p;`  `uncall p;`
- **Expressions**: constants (decimal, `0x`, `0b`), variables, `+ - ^ & |`, unary `~` and `-`, `rol(e, k)`. All 32-bit
  wrapping. There is no multiply or shift yet. Temporaries needed to evaluate `e` are built, used and then un-built, so
  nothing is left behind (Bennett's trick).
- **`if (test) { ... } else { ... } fi (assertion);`** The assertion must be true if the `then` branch ran and false if the
  `else` branch ran; it is what lets the machine know where it came from when run backwards.
- **`from (entry) do { S1 } loop { S2 } until (exit);`** The entry condition is true on the first pass and false on every
  later pass; the loop ends when `exit` is true. Both bodies are optional.
- **`proc p { ... }`** acts on the global variables; `uncall p` runs its inverse (the compiler generates it). No recursion yet.
- **Conditions** compare two variables or constants with `== != < > <= >=` (signed). The machine tests `==`, `!=`, `<` and
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

## Not done yet
Memory variables and arrays, recursion, multiply and shifts, reversible `input()` and the screen, a `logged` escape hatch
with a cost report, a language server. See `status/core.md`.
