# Assembly syntax - DRAFT

Source files are `.s`, assembled by `asm/` into `.rvm` (see `program_format.md`).
Case-insensitive mnemonics. `;` starts a comment. One instruction per line.

```
        .equ   FB, 0x20000          ; constant
        .data                       ; data section, loaded at data address 0
score:  .word  0                    ; one word
buf:    .space 8                    ; 8 zero words
        .code                       ; code section
start:  xori  r1, FB                ; r1 ^= 0x20000 (xori is zero-extended, reaches 0x3FFFF)
        addi  r2, -5
        xor   r3, r2                ; r3 ^= r2
        xld   r4, [r1+0]            ; r4 ^= MEM[r1+0]
        xst   r4, [r1+3]            ; MEM[r1+3] ^= r4
        cswap r5, r6, r7            ; rc, ra, rb
        toff  r1, r2, r3            ; ra, rb, rc
        br    eq, r1, r2, Lthen     ; cc: al | eq | ne | lt
        br    al, Lend              ; ra, rb default to r0 when cc is al
Lthen:  lnd   al, r0, r0, start     ; last operand: label of the BR that jumps here
        call  f
f:      proc  f_end
f_end:  ret
        hlt
```
- Registers `r0`..`r15`; alias `sp` = `r14`. Numbers: decimal, `0x` hex, negative allowed.
- Pseudo-ops: `subi ra,imm`, `neg ra` (= `not ra; addi ra,1`).
- Entry point = label `start` (or `.entry name`). It must not be a jump target.
- The assembler rejects equal registers where SPEC section 4 requires ra≠rb, and violations of the
  control-flow rules in SPEC section 6.
- Planned macros (names tentative, owned by `asm`): `if/else/fi`, `loop`, `compute/copy/uncompute`.
  Until they land, write `br`/`lnd` by hand following the worked examples in SPEC section 6.
