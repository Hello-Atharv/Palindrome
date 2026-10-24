# Reversible Machine Spec

**STATUS: v0.2 DRAFT, decisions applied. Treat the ISA table (section 4), memory map (5) and API
(`vm_api.ts`/`vm_api.h`, section 8) as the contract. Change them only through `core`; every change is logged in
`SPEC_CHANGELOG.md`.** Unresolved items are in section 10.

Companion files: `vm_api.ts` (TypeScript API, canonical for web), `vm_api.h` (C ABI), `program_format.md` (.rvm binary), `input_tape.md`
(input), `asm_syntax.md` (assembly source syntax).

## 0. One-paragraph summary
A 32-bit machine whose every instruction is a bijection on machine state, so any run can be
stepped backwards by computing inverses, with no history log. We build two engines behind one API:
a **logging VM** (normal semantics + per-step delta log; the correctness oracle and benchmark
baseline) and a **reversible VM** (no log). Both must agree on state at every instruction count.
Programs may still carry "garbage" (extra bits they cannot discard); that lives in program
memory, not in VM history.

Glossary: **state** = registers + RW data memory + PC. **t** = instruction count (machine time).
**d** = program direction, +1 normal, -1 "run the program as its own inverse". **oracle** = logging VM.
**garbage** = information a program keeps only because it cannot erase it.

## 1. Principles
- Every instruction is a bijection on state. No instruction destroys information.
- Copy = `XOR` into a zeroed register. Erase = only by uncomputing. Nothing is ever just overwritten.
- Faults (bad operands, bad address, write to read-only) leave state unchanged and stop the VM.

## 2. Data types
- 32-bit words, 16 registers `r0..r15`. Integers only, **no floating point**.
- **Little-endian** wherever bytes are visible (files). Arithmetic wraps mod 2^32, no flags.
- Immediates are sign-extended (`sext`) unless marked `zext`. Signed compare is two's complement.
- Reset state: all registers 0 except `r14` = SP = `0x10000`. Data memory 0 except the loaded image.
- Convention: `r14` is the stack pointer. Stack slots at or above `r14` must be zero (invariant).

## 3. Encoding (32-bit fixed)
`op[31:26] ra[25:22] rb[21:18]` then:
- Format R: `imm18[17:0]` (3-register ops use `rc[17:14]`).
- Format B: `cc[17:16] target16[15:0]` (absolute code word address).

Code space (64K words) and data space (word-addressed, section 5) are **separate**; code is read-only.

## 4. Instruction set (19)
"Inverse" = what `step_back` does to the data. `x≠y` = operands must differ (else fault; assembler
rejects) because equal operands would not be a bijection (`ra += ra` loses the top bit).

| Op | Mnemonic | Effect | Inverse | Constraint |
|---|---|---|---|---|
| 0 | `NOP` | none; PC+1 | none | |
| 1 | `HLT` | VM stops *before* executing it (HALTED) | n/a | program end |
| 2 | `ADD ra,rb` | ra += rb | ra -= rb | ra≠rb |
| 3 | `SUB ra,rb` | ra -= rb | ra += rb | ra≠rb |
| 4 | `ADDI ra,imm` | ra += sext(imm18) | ra -= sext(imm18) | |
| 5 | `XOR ra,rb` | ra ^= rb | same | ra≠rb |
| 6 | `XORI ra,imm` | ra ^= zext(imm18) | same | |
| 7 | `NOT ra` | ra = ~ra | same | |
| 8 | `SWAP ra,rb` | swap ra, rb | same | |
| 9 | `ROLI ra,k` | ra = rotl(ra, k mod 32) | rotl by (32-k) mod 32 | |
| 10 | `XLD ra,[rb+imm]` | ra ^= MEM[rb+sext(imm18)] | same | ra≠rb; any mapped region |
| 11 | `XST ra,[rb+imm]` | MEM[rb+sext(imm18)] ^= ra | same | target RW |
| 12 | `CSWAP rc,ra,rb` | if rc≠0 swap ra, rb (Fredkin) | same | rc∉{ra,rb} |
| 13 | `TOFF ra,rb,rc` | ra ^= rb & rc (Toffoli) | same | ra∉{rb,rc} |
| 14 | `BR cc,ra,rb,T` | PC = cond ? T : PC+1 | PC only (see 6) | |
| 15 | `LND cc,ra,rb,S` | no-op forward; PC+1 | PC only (see 6) | |
| 16 | `CALL T` | MEM[r14] ^= PC+1; r14 += 1; PC = T | see 6 | I[T] is `PROC` |
| 17 | `PROC E` | no-op; marks entry, E = address of the matching `RET` | none | |
| 18 | `RET` | r14 -= 1; v = MEM[r14]; MEM[r14] ^= v; PC = v | see 6 | |

Condition `cc`: 0 `al` (always), 1 `eq` (ra==rb), 2 `ne`, 3 `lt` (signed ra<rb).
Derived by the assembler: `subi`, `neg ra` = `NOT ra; ADDI ra,1`. There is no `MOV/AND/OR/MUL`.
Memory is changed only by xor (`XST`) or swap-through-register; reading is `XLD`.

## 5. Memory map (data space, word addresses, 32-bit word accesses)
| Range | Use | Access |
|---|---|---|
| `0x00000-0x0FFFF` | data (initial image from .rvm) | RW |
| `0x10000-0x1FFFF` | stack (SP starts `0x10000`, grows up) | RW |
| `0x20000-0x207FF` | framebuffer 64x32, row-major, pixel `0x00RRGGBB` | RW |
| `0x30000-0x3FFFF` | input window (`input_tape.md`) | RO |

Everything else faults. Effective address = `(rb + sext(imm18)) mod 2^32`. The VM never draws;
the UI reads the framebuffer via `get_memory`. Note `imm18` is signed (max 131071) but
`XORI` is zero-extended (max 262143): load a high address with `xori r1, 0x20000`.

## 6. Reference semantics (normative pseudocode)
`cond(I)` evaluates `I.cc` on current `R[I.ra], R[I.rb]`. `code[]` is the program.

```
forward(S):                          # one step, d=+1; t -> t+1
  I = code[PC]
  HLT:           return HALTED       # no change
  NOP,PROC,LND:  PC += 1
  data ops:      apply Effect from the table; PC += 1
  BR:            PC = cond(I) ? I.target : PC+1
  CALL:          MEM[R14] ^= PC+1; R14 += 1; PC = I.target
  RET:           R14 -= 1; v = MEM[R14]; MEM[R14] ^= v; PC = v

backward(S):                         # exact inverse of forward; t -> t-1. q = PC
  if t == 0: return AT_START
  I = code[q]
  if I is LND and cond(I):  PC = I.target; return        # undo jump from S
  if I is PROC:             ret = MEM[R14-1]; MEM[R14-1] ^= ret; R14 -= 1
                            PC = ret-1; return           # undo CALL
  J = code[q-1]
  if J is CALL:             E = code[J.target].E; MEM[R14] ^= q; R14 += 1
                            PC = E; return               # undo RET
  undo J on data per the Inverse column; PC = q-1        # J fell through (BR/LND: no data change)
```
Reads of the input window during step `t->t+1` use window(t) (value of t *before* the step),
for both forward and its undo. HLT: in d=+1, `forward` stops at HLT. In d=-1, `forward` (= `backward`)
returns HALTED when `PC == entry`.

Control-flow rules (the assembler checks them; the **logging VM also asserts them**):
1. Any address reached other than by fall-through is an `LND` or `PROC`. A join with n incoming
   edges is a chain of n-1 `LND`s. The instruction before an `LND` may jump instead of falling through.
2. `LND cc,ra,rb,S`: asserts "cc holds here iff we arrived by the jump from the `BR` at S". The reversible
   VM cannot check this (it has no history) and trusts it; the logging VM checks it every time.
3. Each procedure has one `PROC E` entry and one `RET` at `E`. `entry` is not a jump target.
4. Instructions that cannot fall through (`RET`, `HLT`, `BR al`) must be followed by an `LND`, `PROC`,
   or end of code.

### Worked example: if / else
```
        br   eq, r1, r2, Lthen        ; S0: entry test
        ...B...                       ; else body (must not change r1, r2)
S1:     br   al, Lend
Lthen:  lnd  al, r0, r0, S0           ; reached only by the jump from S0
        ...A...                       ; then body (must not change r1, r2)
Lend:   lnd  ne, r1, r2, S1           ; true iff we came from the else side
```
Backwards from `Lend`: if r1≠r2 the predecessor is S1 (the else path), else it is the last instruction of A.

### Worked example: procedure
```
        call f
        ...
f:      proc f_end
        ...body...
f_end:  ret
```

## 7. Time and direction
- `step_forward`: t -> t+1 using `forward` (d=+1) or `backward` (d=-1). `step_back` is its exact inverse.
- `d` is set by the host (`rvm_set_direction`). With d=-1 the program runs as its own inverse
  ("decrypt = run the cipher backwards"). Caveat: programs that read the time-gated input window
  are not exactly self-inverse under d=-1, because the window depends on machine time. Time travel
  (`step_back`) is always exact.
- Direction flips are recorded as `(t, d)` pairs (host metadata, 8 bytes per flip) so `step_back`
  knows which direction each step used. They count in `rvm_history_bytes`; step history does not.
- **Any host action at time t (`set_direction`, `push_input`) starts a new branch: later direction
  flips and later input events are discarded.** Stepping back and forward with no host action is lossless.
- Logging VM: stores per-step deltas, so `rvm_history_bytes` grows with t. Reversible VM:
  `rvm_history_bytes` = 8 bytes per direction flip, nothing per step.
- **Oracle contract:** for the same program, tape and direction schedule, `(R[0..15], PC, RW memory)` and
  the returned status are identical in both VMs at every t, and a fault leaves state unchanged.

## 8. API
**Web code is written against `spec/vm_api.ts`** (TypeScript interface `RVM`, constants, opcodes). It is
implemented first by `web/mock_vm` and later by the WASM build of the C++ VMs, so the UI never changes.
`spec/vm_api.h` is the C ABI underneath (same operations, one-to-one: `rvm_step_back` = `stepBack()`, etc.)
and is what the two C++ VMs implement. The two files must stay in step.

## 9. Decisions taken (formerly open questions)
| Topic | Decision |
|---|---|
| Control flow | `BR`/`LND` + `CALL`/`PROC`/`RET` as above; fall back to Pendulum's scheme if it breaks |
| In-program direction reversal | None. Host-set direction (a `REV` instruction made the predecessor ambiguous) |
| Input | Program-owned cursor over a time-gated read-only window; host action starts a new branch |
| Web boundary | Real C++ VM to WASM (Emscripten); `web/mock_vm` mimics the JS interface meanwhile |
| Arithmetic | No multiply in v0.2. Maybe `MULI` by odd constants later if the cipher needs it |
| Oracle equality | `(R, PC, RW memory)` and status at every t; faults leave state unchanged |
| Sort garbage | The sort writes a permutation record to a fixed region; the UI highlights it |

## 10. Still open
1. Does `BR/LND` compile cleanly for loops? (Verified by the logging VM and the assembler macros first.)
2. Pong collision with little garbage; the cipher key schedule without multiply.
3. Garbage macros (`compute/copy/uncompute`) after basic `if`/`loop` macros.
4. Framebuffer fixed at 64x32 for now.
