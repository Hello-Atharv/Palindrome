# Assembly syntax

Source files are `.s`, assembled by `asm/` (TypeScript; Node command line and browser) into `.rvm`
(`program_format.md`). Mnemonics, condition names and register names are case-insensitive; labels and
constants are case-sensitive. `;` starts a comment. One instruction or directive per line. Several labels may
precede a line, and a label may stand alone.

```
        .equ   FB, 0x20000          ; constant
        .data                       ; data section, loaded at data address 0
score:  .word  0                    ; one or more words: .word 1, 2, 0xFF, -1, 'A', FB+4
buf:    .space 8                    ; 8 zero words
        .code                       ; code section (the default)
start:  xori  r1, FB                ; r1 ^= 0x20000 (xori is zero-extended, reaches 0x3FFFF)
        addi  r2, -5
        addi  r3, score             ; a data label is its data address
        xor   r3, r2                ; r3 ^= r2
        xld   r4, [r1+0]            ; r4 ^= MEM[r1+0]       also [r1], [r1-4], [sp+2]
        xst   r4, [r1+3]            ; MEM[r1+3] ^= r4
        cswap r5, r6, r7            ; if r5 != 0 swap r6, r7   (rc, ra, rb)
        toff  r1, r2, r3            ; r1 ^= r2 & r3            (ra, rb, rc)
S0:     br    eq, r1, r2, Lthen     ; cc: al | eq | ne | lt
        br    al, Lend              ; with al, ra and rb are omitted (they default to r0)
Lthen:  lnd   al, r0, r0, S0        ; last operand: label of the BR that jumps here
        call  f
f:      proc  f_end                 ; operand: label of this procedure's single ret
f_end:  ret
Lend:   hlt
```

## Reference
- **Registers:** `r0`..`r15`; `sp` is `r14`.
- **Numbers and expressions:** decimal, `0x` hex, `0b` binary, `'A'` characters, negative numbers, symbols,
  `+`, `-` and parentheses (no `*`). Forward references to labels work everywhere; `.equ` values may only use
  symbols defined earlier. A data label means its data address, a code label its code address.
- **Directives:** `.equ NAME, value`; `.data` / `.code` (`.text` is a synonym for `.code`); `.word v, ...` and
  `.space n` (data section only); `.entry label`.
- **Entry point:** `.entry label`, otherwise the label `start`, otherwise address 0. It must not be a jump target.
- **Instructions (19):** `nop`, `hlt`, `add`, `sub`, `addi`, `xor`, `xori`, `not`, `swap`, `roli`, `xld`, `xst`,
  `cswap`, `toff`, `br`, `lnd`, `call`, `proc`, `ret` (semantics in SPEC section 4).
- **Pseudo-ops:** `subi ra, imm` (= `addi ra, -imm`), `neg ra` (= `not ra` then `addi ra, 1`, two words).
- **Immediate ranges:** `addi`/offsets in `[-131072, 131071]`; `xori` in `[0, 262143]`; `roli` count in `[0, 31]`.
- **Sections:** instructions only in `.code`; `.word` and `.space` only in `.data`. Code ≤ 65,536 words, data ≤ 65,536 words.

## What the assembler rejects (errors)
Equal registers where the instruction would not be reversible (`add`/`sub`/`xor` with `ra = rb`, `xld` with
`ra =` the base register, `cswap` with `rc` equal to either swapped register, `toff` with `ra` equal to either
control); out-of-range immediates; undefined or duplicate labels; a label named like a register; and violations of
the control-flow rules in SPEC section 6:
- a `br` must jump to an `lnd` whose source operand is that `br`, and every `lnd`'s source must be a `br` that
  jumps to it;
- `call` must target a `proc`; each `proc` names a `ret` after it; each `ret` is named by exactly one `proc`;
- the instruction after `hlt`, `ret` or `br al` must be an `lnd` or a `proc`; a `proc` must not be reachable by
  falling through (its predecessor must be `hlt`, `ret`, `br al` or `call`);
- the last instruction must be `hlt`, `ret` or `br al` (no running off the end); the entry must not be an
  `lnd` or a `proc`.

Warnings: `swap r, r` (no effect); a program with no `hlt`.

Diagnostics are reported in source order as `file:line: error: message`. After an error the assembler keeps
checking later lines.

## Using it
```
cd asm && npm install && npm run build         # once
node asm/dist/cli.js prog.s -o prog.rvm [--map prog.rvm.map] [--list]
```
In code (Node or browser): `assemble(source, { fileName })` returns `{ ok, image, code, data, entry, diagnostics,
listing, symbols, sourceMap }`. Run a program on either engine with the `rvm_run` tool built by the root CMake
project: `rvm_run prog.rvm --engine reversible --rewind`.

## Macros: if/else and loops
These expand to the `br`/`lnd` pairs of SPEC section 6 before assembly, so you never write the landing
bookkeeping by hand. `asm/examples/ifelse_macro.s` and `loop_macro.s` assemble to exactly the same code as the
hand-written `ifelse.s` and `loop.s`.

```
        .if   eq, r1, r2        ; entry test: take the "then" side when r1 == r2
        addi  r3, 7             ; then body
        .else                   ; optional
        addi  r3, 100           ; else body
        .fi   ne, r1, r2        ; exit assertion: this condition holds iff we came from the ELSE side

        .loop  ne, r2, r0       ; head assertion: holds iff we arrived by the back edge (false on first entry)
        ...body...
        .again ne, r2, r1       ; go around again while this condition holds
```
- All five macros take `cc, ra, rb` (`cc` is `al`, `eq`, `ne` or `lt`); `.else` takes none. They nest freely.
- **The programmer's duty (Janus's rule):** the `.fi` condition must be true when the else side ran and false when the
  then side ran (so the bodies must leave the values it reads telling the two sides apart, or set them to do so; the
  usual way is to let the `.if` test registers be untouched and reuse them, or to record the choice in a flag register
  as `programs/sort.s` does). The `.if` test is only evaluated on entry, so the bodies are free to change the registers
  it names. The loop head condition must be false on the first entry and true on every later one. The logging VM faults
  ("LND assertion failed") the moment one of these is wrong; the reversible VM trusts it. Test new code on the
  logging engine first.
- A program must not start with `.loop` (its head is a landing and cannot be the entry); put an instruction first.
- Generated labels start with `$` and are hidden from the symbol table; user labels may not start with `$`. A label
  on a macro line attaches to the first instruction it generates. Listing lines for generated code carry the line
  number of the macro line that produced them.
- Not yet: `compute/copy/uncompute` (Bennett-style) macros.
