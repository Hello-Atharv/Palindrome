# Demo script (about 5 minutes)

Thesis in one line: **a reversible toolchain where the cost of undoing is visible at every layer.**
Every number shown is one of the quantities in `spec/SPEC.md` section 12, measured as defined there.
Items marked *(planned)* are not built yet. Cut or fake nothing: if a moment is not ready, drop it from the demo.

## Claim we make (and the one we do not)
- We make: we found no existing open, browser-based, verified toolchain for a reversible ISA with a time-travel
  debugger and a measured comparison against conventional rewind.
- We do not make: that reversible computing, reverse debugging or rollback were invented here. Say the names
  (Bennett, Janus, Pendulum) before a judge does.

## Beats
| # | Time | What the audience sees | What it proves | Status |
|---|---|---|---|---|
| 1 | 0:00 | Pong plays in the browser. Pause, scrub back through 2 seconds of play, resume with a different key press. | Time travel on a real program. | built (`web/wasm` playground) |
| 2 | 0:45 | **Compare engines.** Same Pong on both engines, shared clock. Diary history climbs (about 19 KB per frame); reversible stays at 0. The "states match" badge stays green while we scrub. | Rewinding needs no history memory; the engines agree. | built |
| 3 | 1:30 | The honest cost, said out loud: reversible rewind is 2 to 5 times slower per step, and the diary here is naive (48 B/step). Show the tight-diary row. | We report the downside and a fair baseline. | tight diary *(planned)* |
| 4 | 2:15 | The sort: the screen shows the sorted list and, in the row below, the **garbage** the sort cannot erase. | Information is conserved; erasing is the thing that costs. | built |
| 5 | 3:00 | Write a few lines in the language, compile, see the **cost report** (which lines keep values, how many bits). | The cost is visible at the source level. | compiler *(planned)* |
| 6 | 3:45 | Debugger: set a reverse watchpoint on a variable, run backwards to the instruction that wrote it. No log exists. | Step back is computing inverses. | debugger in progress |
| 7 | 4:30 | The benchmark chart: memory held vs steps to undo, for naive diary, tight diary, checkpoint-and-replay, reversible. | The headline, with fair baselines. | *(planned)* |

## Showpiece (pick one, beat 8 if time)
- Reversible network that stores no activations while training or rewinding, or two-player rollback.
Not committed to yet. Do not announce either until it runs.

## Questions we expect, and straight answers
- *"Is this new?"* The idea is old (Bennett 1973, Janus 1982, Pendulum). The measured, verified, in-browser stack is the work.
- *"Why is the diary 48 bytes a step?"* It is our simple diary. The tight diary (section 12.2) is the fair floor.
- *"What does reversibility cost?"* Extra instructions and garbage, measured as `overhead_steps`, `overhead_code`,
  `garbage_bits`. Until the conventional twins exist, say "not measured yet".
- *"Does direction -1 work for Pong?"* Not exactly: programs that read input are not self-inverse under it. Step back and
  scrubbing are always exact.

## Before demo day
- Hand-play Pong with a real keyboard (never done).
- Re-run `npm test`, `npm run test:asm`, `npm run test:wasm`.
- Check the pushed commit builds from a clean clone.
