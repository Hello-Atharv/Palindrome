# Input tape - DRAFT

Host input (keys etc.) is recorded as a **tape** of timestamped events. The VM never "reads
a device": it reads a read-only memory window whose contents are a pure function of
`(tape, t)`, where `t` = instruction count. So input is deterministic, replayable, and needs
no history in the VM.

## Tape file (.tape), little-endian u32
`magic "RVMT"`, `count`, then `count` pairs `(t, value)` with `t` non-decreasing.
Event k becomes visible when the machine reaches time `t_k` and stays visible.

## Window (data space, base `IN_BASE` = 0x30000, read-only)
| Word | Content |
|---|---|
| IN_BASE+0 | `TIME`: current t (low 32 bits) |
| IN_BASE+1 | `COUNT`: number of events with `t_k <= t` |
| IN_BASE+2+k | value of event k if `k < COUNT`, else 0 |

Reads use `XLD`. Writes fault. A step from `t` to `t+1` (and its undo) reads the window as of `t`.
Under program direction -1 the window still follows machine time, so input-reading programs are
not exactly self-inverse there; time travel (`step_back`) is always exact.

## Consuming and un-consuming
"Consume" = the program increments its own cursor (a register or data word). That is an
ordinary reversible `ADDI`, so running backwards decrements the cursor: the event is
un-consumed for free. Moving back past `t_k` also makes the event vanish from the window.

Typical poll: `cursor < COUNT` ? read `value[cursor]`, `cursor += 1`.

## Live input and the API
`rvm_push_input(v)` appends `(t_now, v)`. If the user has scrubbed back to `t_now` below the
tape's last timestamp, later events are discarded (new timeline branch). Saving the tape
gives a replayable run. Open question in SPEC.md: keep branching, or forbid input while scrubbed.
