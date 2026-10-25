# Reference: everything the toolchain can do

One page listing every part of the toolchain, every command, and every control in the app. Each section says where the full
documentation is. If you only have a few minutes, read [the tour](TOUR.md) first.

## 1. The pieces
| Piece | What it does | Where | Full docs |
|---|---|---|---|
| **The machine** | 19 instructions, each reversible. Two engines: a *logging* one (keeps a diary, the oracle) and a *reversible* one (keeps nothing). Checked identical after every step. C++, also compiled to WebAssembly. | `vm/` | [Spec](../spec/SPEC.md) |
| **Assembler** | Turns assembly into machine code. Macros for `if`, loops, temporaries and drawing; checks the rules that make branches reversible. Runs in Node and in the browser. | `asm/` | [Assembly syntax](../spec/asm_syntax.md) |
| **`rev` language and compiler** | A reversible language compiled to the machine, with a cost report per source line. | `lang/` | [The rev language](LANGUAGE.md) |
| **`rvm` command line** | Build, run, report, verify and debug a program. | `cli/` | [Command line and debugger](../cli/README.md) |
| **Debugger** | Steps forward and **back** by source line, breakpoints, and "who last wrote this?" by running time backwards. | `cli/src/debugger.ts` | [Command line and debugger](../cli/README.md) |
| **Browser app** | This app: play, scrub time, compare engines, edit `rev` live with its cost report, benchmarks, these docs. | `web/viz/` | [Architecture](ARCHITECTURE.md) |
| **VS Code extension** | Colours, errors as you type, and the cost beside each line. | `vscode/` | [VS Code extension](../vscode/README.md) |
| **Benchmarks** | Speed of both engines, and fair baselines (a bit-packed diary, checkpoints) measured against conventional versions of the sort and Pong. | `bench/` | [Benchmarks](../bench/TWINS.md), [Engine speed](../bench/RESULTS.md) |
| **Demo programs** | A Speck64/128 cipher, a sort that exposes its garbage, Pong (in assembly and in `rev`), and small teaching programs. | `examples/` | [Demo programs](../examples/demos/README.md) |

## 2. Commands (from the repository root)
| Command | What it does |
|---|---|
| `npm run setup` | Install everything and build the command-line tools (once). |
| `npm run demo` | The narrated debugger tour: press Enter to run each step. |
| `npm run viz` | Start this app locally at http://localhost:5173/. |
| `npm run rvm -- <command> <program>` | The `rvm` tool (section 3). |
| `npm run rvmc -- prog.rev --report` | Compile a `rev` file; `--asm out.s` keeps the assembly, `--report` prints the cost report. |
| `npm run check` | Every test and typecheck, including the app. Run before every push. |
| `npm run test:all` | The engines, assembler, compiler, command line, extension and benchmarks. |
| `npm run bench:twins` | Regenerate the fair-baseline benchmark ([TWINS.md](../bench/TWINS.md) and `results.json`). |
| `npm run build` / `npm test` | Build the C++ engines / build and run the C++ tests (needs CMake). Not needed to try the project. |
| `npm run build:wasm` | Rebuild the WebAssembly engines (needs Emscripten). |

## 3. The `rvm` command
A program is a `.rev` file or an `.s` file. Run it as `npm run rvm -- <command> <program>`.

| Command | What it does |
|---|---|
| `build prog -o prog.rvm` | Compile or assemble to a machine-code file. |
| `run prog [--engine logging\|reversible]` | Run to the halt, print the variables and anything it printed. |
| `report prog.rev` | The cost report: steps per source line, the garbage kept, history bytes, and that the whole run undoes exactly. |
| `verify prog` | Check the program on both engines: they agree after every step, 200 random jumps in time leave them identical, undoing the whole run reaches the start. Prints pass or FAIL; exit code 1 on failure. This is testing, not proof. |
| `debug prog [--script "s; s; rwatch x"] [--demo file]` | The debugger (next section). `--script` runs commands, `--demo` is a narrated session. |

## 4. The debugger
Start it with `npm run rvm -- debug examples/rev/tour.rev`. You get a `(rvm)` prompt. A variable is written by name, `r0` to `r15`, or `[address]`.

| Command | What it does |
|---|---|
| `s [n]` / `b [n]` | Step forward / **back** one source line (into calls). |
| `n [n]` | Next line, stepping **over** a call. |
| `si [n]` / `bi [n]` | One machine instruction forward / back. |
| `c` / `rc` | Continue / **reverse**-continue, to the next breakpoint or the end / start. |
| `break N` / `delete N` / `info break` | Set, remove and list breakpoints on source line N. |
| `goto T` | Jump to machine time T. |
| `watch X` / `rwatch X` | Run forward / **backward** until X changes. `rwatch` answers "who last wrote this?", printing the line and the old and new value. |
| `p [X]` | Print all variables, or one. |
| `regs`, `mem A [n]`, `list`, `where` | Registers; memory words; the source around here; the time and line. |
| `console` | What the program has printed so far (it un-prints as you step back). |
| `history` | How many bytes of history the machine is keeping (0 for the reversible engine). |
| `help`, `quit` | List the commands; leave. |

`#` starts a comment, so annotated lists can be pasted. On the reversible engine none of this needs a recorded history: it just computes
inverses. [Full details](../cli/README.md).

## 5. The browser app
**Regions.** The left side is the code editor with its debug bar; the right side has tabs. The vertical button on the divider (or **Ctrl+B**)
hides the editor.

| Control | What it does |
|---|---|
| Program picker (top right) | Choose a demo. Every program is shown in `.rev` and in `.s`, which is exactly what the compiler produces from it. |
| **.s \| .rev** switch | Show the assembly or the `rev` source of the same program. |
| **Diary \| Reversible** | Choose which engine runs it. |
| **Build and load** (Ctrl+Enter) | Compile or assemble what is in the editor and load it (resets to time 0). For `rev`, the cost report appears under the editor. |
| **Stop** / **Restart** | Go back to the start. It reads *Restart* once the program has halted. |
| **Run back** / **Run forward** | Run backwards in time / forwards. Both read *Pause* while running. |
| **Back** / **Step** | One instruction back / forward. Games also get **back one frame** and **forward one frame**. |
| Speed | Slow to Instant for the animation, or steps per second (or a custom speed). |
| Time bar | Drag to any earlier moment. A key press after scrubbing back starts a new timeline. |
| Gutter dot | Click the strip left of a line number to set a **breakpoint** (a red dot); a run, forward or back, stops when the machine reaches that line. Click it again to remove it. Loading another program clears them. |
| **Visualisation** tab | The datapath, animated, for small programs (up to 64 instructions). Bigger programs open in Output. |
| **Output** tab | The console and the 64 by 32 screen. **Send a number** and **Send keys to the machine** give the program input. |
| **Compare engines** | Both engines side by side; **Measure both engines** runs a program forward and back on each and compares history, garbage and time. |
| **Benchmarks** tab | The fair baselines for Pong and sort, as a chart and a table. |
| **Docs** tab | These documents. |
| Editor keys | **Tab** indents, **Shift+Tab** outdents, **Esc then Tab** leaves the editor. |

**Keyboard shortcuts.** Alt+0 stop, Alt+, step back, Alt+. step, Alt+Space run or pause, Ctrl+B show or hide the editor, Ctrl+Enter build.
In Pong, W / S or the arrow keys move the paddle.

## 6. The VS Code extension
Colours for `.rev` and `.s`; the compiler's errors as you type; the cost of each line beside it after you save; a status bar with steps,
history (0 B) against what a diary would need, the garbage kept, and whether undoing the run reproduced the same states; the command
**rev: Show cost report**; and **rev: Debug with step back (terminal)**. [Install and details](../vscode/README.md).

## 7. The languages
- **`rev`**: variables, arrays, `+=`, `-=`, `^=` and swap (never plain assignment), `if`, loops, procedures with `call` and `uncall`,
  input, and `print`. [The language reference](LANGUAGE.md); `examples/rev/tour.rev` is the whole language in one short program.
- **Assembly**: 19 instructions plus macros. [Syntax and macros](../spec/asm_syntax.md).

## 8. Tests and checks
About 430 automated tests across the engines, assembler, compiler, command line, extension, benchmarks and this app. The two engines are
run against each other on random programs; the compiler is fuzzed against an independent interpreter; the key-race test presses a key at
every point of a Pong frame. `npm run check` runs everything.
