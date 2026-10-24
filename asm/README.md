# asm/
Purpose: the assembler. Written in TypeScript; runs as a Node command line tool and in the browser (Code view).
Turns `.s` assembly (`spec/asm_syntax.md`) into `.rvm` images (`spec/program_format.md`) plus a source map. Checks
the register-distinct rules and the BR/LND and CALL/PROC/RET pairing rules. Later: `if`/`loop` macros.
Owner: **core**.
