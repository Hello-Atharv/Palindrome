# VS Code extension: rev and the reversible assembly

What it gives you in the editor:
- **Syntax colouring** for `.rev` (the reversible language) and `.s` (the machine's assembly, including the macros).
- **Diagnostics as you type**: the compiler's and assembler's errors, underlined on the right line (the same checks as `rvmc`).
- **The cost beside every line**: save a `.rev` file and each line that ran shows `477 steps, 1.9%` after it. The status bar
  shows the run: steps, the history the machine needed (0 B) against what a diary would need, the garbage the program kept, and
  whether undoing the whole run and replaying it reproduced the same states.
- **`rev: Show cost report`** (command palette, or click the status bar): the full report in an output panel.
- **`rev: Debug with step back (terminal)`**: opens `npm run rvm -- debug <file>` in a terminal: the gdb-style debugger with
  source-line step **back**, `rwatch` ("who last wrote this?") and breakpoints (see `cli/README.md`).

Settings: `rev.costOnSave` (default on), `rev.maxSteps` (default 400,000).

## Try it
```
cd vscode && npm install && npm run build
```
Then open the `vscode/` folder in VS Code and press **F5** (a launch configuration is included): a second window opens with the
extension loaded; open `programs/pong.rev` or `lang/examples/sort8.rev` in it and save.
To install it permanently: `npx @vscode/vsce package` in this folder, then *Extensions: Install from VSIX*.

## What is tested, and what is not
`npm test` (8 tests) runs the grammars through the same TextMate engine VS Code uses (keywords, numbers, operators, comments,
labels, macros are coloured as intended) and tests the logic behind the features: diagnostics, per-line costs, the summary line,
errors and broken assertions. The bundle (`dist/extension.js`, built with esbuild, containing the compiler, assembler and the
WebAssembly engines) is checked by running its core in plain Node.
**Not tested:** the thin glue in `src/extension.ts` that connects these to the editor (decorations, status bar, commands) has not
been run inside a real VS Code window. It is about 100 lines; if something looks off when you press F5, that file is where to look.

## Layout
`src/core.ts` editor logic (no vscode import, tested) · `src/extension.ts` glue · `syntaxes/` TextMate grammars ·
`build.mjs` bundler · `test/` tests.
