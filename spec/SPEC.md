# Reversible Machine Spec

**STATUS: DRAFT v0.1.** Nothing here is agreed until the team settles "Open questions" at the end.
Changes: log in `SPEC_CHANGELOG.md`.

## 1. Principles
- Machine state `S = (R[0..15], RW data memory, PC)`. Time `t` (instruction count) is an input to
  a step, not stored state.
- Every instruction is a **bijection** on `S`. No instruction destroys information, so
  `step_back` needs no log. Copying is `XOR` into a zeroed register; "erasing" is only possible
  by uncomputing (running the copy's computation backwards). Garbage is real and visible.
- Faults (illegal operands, bad address, write to read-only) leave `S` unchanged and stop the VM.

## 2. Data types (why: determinism, easy to test, same result on MSVC and Apple clang)
- **32-bit words**, 16 registers `r0..r15`. Fixed-width integers only. **No floating point.**
- **Little-endian** wherever bytes are visible (program files, tape files).
- **Wraparound**: all arithmetic is mod 2^32; `ADD`/`SUB`/`ADDI` wrap, no overflow flags.
  Immediates are sign-extended unless stated. Signed compare uses two's complement.
- Convention: `r14` = SP (starts at `0x10000`), `r15` = free. All other registers start 0.

## 3. Instruction encoding
32 bits, fixed width. `op[31:26] ra[25:22] rb[21:18]`, then one of:
- Format R: `imm18[17:0]`; 3-register ops use `rc[17:14]`.
- Format B: `cc[17:16] target16[15:0]` (absolute code word address).

Code space and data space are **separate** (Harvard); code is read-only at run time.
Code: 64K words. Data: word-addressed, see section 5.

## 4. Instruction set (19)
Inverse column: how `step_back` undoes it (the same table, read right to left, gives program
direction -1). "x≠y" means the VM faults / assembler rejects equal register operands, because
the op would not be a bijection (`ra += ra` loses the top bit).

| # | Mnemonic | Effect | Inverse | Constraint |
|---|---|---|---|---|
| 0 | `NOP` | none | NOP | |
| 1 | `HLT` | VM stops *before* executing it (status HALTED) | n/a | marks program end |
| 2 | `ADD ra,rb` | ra += rb | `SUB ra,rb` | ra≠rb |
| 3 | `SUB ra,rb` | ra -= rb | `ADD ra,rb` | ra≠rb |
| 4 | `ADDI ra,imm` | ra += sext(imm18) | `ADDI ra,-imm` | |
| 5 | `XOR ra,rb` | ra ^= rb | itself | ra≠rb |
| 6 | `XORI ra,imm` | ra ^= zext(imm18) | itself | |
| 7 | `NOT ra` | ra = ~ra | itself | |
| 8 | `SWAP ra,rb` | swap | itself | |
| 9 | `ROLI ra,k` | ra = rotl(ra, k mod 32) | `ROLI ra,32-k` | |
| 10 | `XLD ra,[rb+imm]` | ra ^= MEM[rb+sext(imm18)] | itself | ra≠rb; any mapped region |
| 11 | `XST ra,[rb+imm]` | MEM[rb+sext(imm18)] ^= ra | itself | target RW |
| 12 | `CSWAP rc,ra,rb` | if rc≠0: swap ra,rb (Fredkin) | itself | rc∉{ra,rb} |
| 13 | `TOFF ra,rb,rc` | ra ^= rb & rc (Toffoli) | itself | ra∉{rb,rc} |
| 14 | `BR cc,ra,rb,T` | see 4.1 | see 4.1 | |
| 15 | `LND cc,ra,rb,S` | see 4.1 | see 4.1 | |
| 16 | `CALL T` | see 4.2 | see 4.2 | |
| 17 | `PROC E` | marks callee entry; E = address of its `RET`; no-op | NOP | |
| 18 | `RET` | see 4.2 | see 4.2 | |

Why xor-load/store and no `MOV`/`AND`/`OR`: those destroy the old value. `XLD`/`XST` are
self-inverse and compose into copies. Memory is only ever xor-updated or swapped.
Multiplication is left out of v0.1 (only odd constants are bijective; see open questions).

### 4.1 Paired branches (Janus entry test / exit assertion, no history needed)
`cc`: 0 always, 1 `ra==rb`, 2 `ra!=rb`, 3 signed `ra<rb`.
- `BR cc,ra,rb,T` at address S: if cc holds then `PC=T` else `PC=S+1`. Changes only PC.
- `LND cc,ra,rb,S` at address T (the landing, "come-from"): forward it is a no-op (`PC=T+1`).
  The programmer asserts: **cc holds here iff we arrived by the jump from S**, else by fall-through.
  The logging VM checks this (it knows the previous PC); the reversible VM cannot, and trusts it.
- Inverse of a step that ended at address q: if `I[q]` is `LND` and cc holds, the predecessor
  is S; otherwise q-1 (or see 4.2). Then undo that predecessor (BR undo = nothing).
- Rule (assembler-checked): any address reachable other than by fall-through is an `LND`
  or `PROC`. A join with n incoming edges is a chain of n-1 `LND`s. `if`/`loop` macros hide this.

### 4.2 Reversible call/return (single entry, single exit per procedure)
Stack grows up from `r14`.
- `CALL T` at C: `MEM[r14] ^= C+1; r14 += 1; PC = T`. `I[T]` must be `PROC E`.
- `RET` at E: `r14 -= 1; PC = MEM[r14]; MEM[r14] ^= PC` (slot returns to 0).
- Inverse of `CALL`: reached at `q = T` (the `PROC`): `ret = MEM[r14-1]; MEM[r14-1] ^= ret;
  r14 -= 1; PC = ret-1`.
- Inverse of `RET`: reached at `q = C+1` where `I[q-1]` is `CALL T`: `PC = E` (from `I[T]`),
  `MEM[r14] ^= q; r14 += 1`.
- Because the return address is *xored into a zero slot and zeroed again*, the stack holds no
  garbage after a balanced call/return. Recursion works; each procedure has exactly one `RET`.

## 5. Memory map (data space, word addresses; accesses are 32-bit words)
| Range | Use | Access |
|---|---|---|
| `0x00000-0x0FFFF` | data (initial image from the .rvm file) | RW |
| `0x10000-0x1FFFF` | stack | RW |
| `0x20000-0x207FF` | framebuffer, 64x32, row-major, one word per pixel (`0x00RRGGBB`) | RW |
| `0x30000-0x3FFFF` | input tape window (`spec/input_tape.md`) | RO |

The VM never draws; the UI reads the framebuffer through `rvm_get_memory`.
Everything else faults. Address = `(rb + sext(imm18)) mod 2^32`.

## 6. Time and direction
- `step_forward`: t→t+1 by `F_d`. `step_back`: t→t-1, the exact inverse of the last step.
- `d` (direction) is host-set (`rvm_set_direction`). With `d=-1`, `F` executes the program's
  inverse, so "run the cipher in reverse" is a button, not a second program. `F_-1` is
  `step_back` of the `d=+1` machine.
- Logging VM: records deltas (old values of changed regs/mem/PC) per step; `rvm_history_bytes`
  grows linearly. Reversible VM: `rvm_history_bytes` = 0. Both must agree on `(R, PC, RW memory)`
  at every t (differential tests).

## 7. Open questions (settle in the first hour)
1. **Control-flow scheme.** Is BR/LND + CALL/PROC/RET (above) good enough, or adopt Pendulum's
   branch-register scheme? Must make "find predecessor without a log" provable and checkable
   by the assembler. Do loops/ifs compile cleanly to it?
2. **In-program direction reversal.** A `REV` instruction (program turns itself around) was
   dropped: from `(PC=p-1, d=-1)` the predecessor is ambiguous (REV at p, or inverse of `I[p]`).
   Is host-set direction enough for the demos?
3. **Input tape model.** Program-owned cursor over a time-gated window (above) vs a VM-owned
   consume instruction. On live input while scrubbed back: branch the timeline (above) or forbid?
4. **VM-to-web boundary.** Emscripten/WASM of the real C++ VM (works on native Windows) vs a JS port
   vs a local server. Decides what `web/mock_vm` must mimic and whether `vm_api.h` needs a batch call.
5. **Expressiveness.** Multiply by odd constants (bijective mod 2^32)? Shifts need garbage. Enough
   for cipher + sort + Pong? Also: framebuffer size, 64K-word memories, and whether `r14`/SP
   should be hardware-enforced.
6. Differential-test contract: state equality = `(R, PC, RW memory)` at every t? Faults: identical
   status and unchanged state in both VMs?
7. Garbage convention: does the assembler offer Bennett-style `compute/copy/uncompute` macros?
8. Sort "garbage": what exactly do we expose and how does the UI show it?
