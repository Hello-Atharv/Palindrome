# rvm: the command line

One command for the whole stack. From the repo root: `npm run rvm -- <command> <program> [options]`. The tools are bundled into
single files (`cli/dist/rvm.mjs`, `rvmc.mjs`) that run with plain `node` on Windows, Linux (WSL) and macOS and need no `node_modules`;
`npm run setup` builds them, or run `npm run build:cli` after changing the source. `npm run rvm:dev` runs the TypeScript source directly. A program is a `.rev` file
(compiled by `lang/`) or a `.s` file (assembled by `asm/`).

| command | what it does |
|---|---|
| `build prog -o prog.rvm [--asm out.s]` | compile / assemble; `--asm` keeps the generated assembly of a `.rev` |
| `run prog [--engine logging\|reversible]` | run to the halt, print the variables (or non-zero registers) |
| `report prog.rev` | cost report: steps per source line, garbage, history bytes, exact round trip |
| `verify prog` | check the program against the contract on both engines (below) |
| `debug prog [--engine ...] [--script "s; s; rwatch x"]` | debugger with step back; interactive, piped, or scripted |

## verify
Runs the program on the logging and reversible engines and reports pass or FAIL for: it builds; the logging engine runs it to the
halt with every landing assertion true; both engines agree on registers and pc after every step and on memory every 64th step;
200 random steps, step-backs and jumps in time leave them identical; undoing the whole run reaches the initial state and replaying
reaches the final state; and (for `.rev`) direction -1 runs the program as its own inverse back to the start. This is testing on
this program and this input, not a proof, and the output says so. Exit code 1 on failure.

## debug
```
s [n]  b [n]      step forward / BACK one source line         n    next (steps over a call)
si [n] bi [n]     one machine instruction forward / back       c    continue     rc   reverse-continue
break N / delete N / info break                                goto T   jump to machine time T
watch X   rwatch X   run forward / BACKWARD until X changes: rwatch answers "who last wrote this?"
p [X]  regs  mem A [n]  list  where  history                   X = a variable, r0..r15, or [address]
```
`rwatch f1` runs the program backwards until `f1` changes and stops at the instruction that wrote it, printing the source line and
the old and new values. On the reversible engine that needs no recorded history (`history` shows 0 bytes); on the logging engine it
works too, from the diary. Both engines print the same transcript (tested).

The logic is in `src/debugger.ts` with no terminal code, over the `RVM` interface of `spec/vm_api.ts`, so a web or VS Code front end
can reuse it. `src/repl.ts` is the text front end.

## Tests
`npm run test:cli` (about 30 seconds: it verifies the cipher, sort and Pong on both engines).
