# programs/
Purpose: demo programs in assembly (`spec/asm_syntax.md`): Pong first, a reversible cipher, a sort that exposes
its garbage. Owner: **games**.

## Reversible idioms (starter notes)
- No `MOV/AND/OR`. Copy a value: `xor rdst, rsrc` into a zeroed `rdst`. "Clear" only by undoing how it was made.
- Update with `addi`/`add`/`sub`. Negate: `not r; addi r,1`. Conditional change: branch with `br`/`lnd` (SPEC section 6 examples).
- **Draw with XOR.** `xst` a sprite pixel to draw it, `xst` the same value again to erase it. This avoids "overwriting" the framebuffer.
- Load a big constant with `xori r, imm` (zero-extended, reaches 0x3FFFF). Framebuffer base is `0x20000`.
- Input: keep a cursor register; poll `COUNT` at `0x30001`; read event k at `0x30002+k`; `addi cursor,1` to consume. Running backwards un-consumes for free.
- Pacing: read `TIME` at `0x30000`; busy-wait loops are fine (they are reversible and just spend steps).
- Garbage is expected. Note what each program leaves behind; the benchmarks and writeup will report it.
- Before the assembler exists: write a plain-JS model of the game and fix the register/memory layout first.
