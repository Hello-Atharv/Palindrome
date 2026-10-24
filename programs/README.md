# programs/
Purpose: demo programs in assembly (`spec/asm_syntax.md`): Pong first, a reversible cipher, a sort that exposes
its garbage. Owner: **games**.

## Reversible idioms (starter notes)
- No `MOV/AND/OR`. Copy a value: `xor rdst, rsrc` into a zeroed `rdst`. "Clear" only by undoing how it was made.
- Update with `addi`/`add`/`sub`. Negate: `not r; addi r,1`. Conditional change: branch with `br`/`lnd` (SPEC section 6 examples).
- **Draw with XOR.** `xst` a sprite pixel to draw it, `xst` the same value again to erase it. This avoids "overwriting" the framebuffer.
- Load a big constant with `xori r, imm` (zero-extended, reaches 0x3FFFF). Framebuffer base is `0x20000`.
- Input: keep a cursor register; poll `COUNT` at `0x30001`; read event k at `0x30002+k`; `addi cursor,1` to consume. Running backwards un-consumes for free.
- Keys: each input event is `code | (released ? 0x100 : 0)`. A press is the plain code (uppercase ASCII, Space 0x20, Enter 0x0D, arrows Up/Down/Left/Right = 0x80/0x81/0x82/0x83); bit 8 means released. See `spec/input_tape.md`.
- Frames: add 1 to the word at `0xFFFF` once per frame so the debugger can step by frame (SPEC section 11.7).
- Pacing: read `TIME` at `0x30000`; busy-wait loops are fine (they are reversible and just spend steps).
- Garbage is expected. Note what each program leaves behind; the benchmarks and writeup will report it.
- Before the assembler exists: write a plain-JS model of the game and fix the register/memory layout first.
