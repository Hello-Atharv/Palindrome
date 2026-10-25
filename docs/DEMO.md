# Demo script (about 5 minutes)

This is the script you present from: what to click, what to say, what each beat proves, and what to do if something breaks.
It is not the story (that is `WRITEUP.md`) and not the explanation (that is `GUIDE.md`); read it the evening before, with the app open.

**Thesis, in one line:** a computer where every instruction can be undone, so time runs backwards with no history log, and the price of
that is measured out loud against fair opponents. *We did not make undoing free; we made its cost impossible to hide.*

Everything shown comes from the quantities in `spec/SPEC.md` section 12. Say Bennett, Janus and Pendulum before a judge does.

## Before you start (two minutes)
- Open the app: https://reversible-machine.vercel.app (backup: `npm run viz`, then http://localhost:5173). Pick **pong**. Click the page once so
  the keyboard goes to the game.
- In a terminal at the repo root, have this typed and ready (do not press Enter yet), and open `examples/rev/tour.rev` beside it:
  `npm run demo`
  It runs the narrated debugger tour: press **Enter** to run each step, `quit` leaves, and at the end it hands you a live `(rvm)` prompt (`help` lists the commands).
- Have a screen recording of the whole run as the fallback for any beat (record it once, in advance).

## The beats
| # | Time | Do | Say | Shows |
|---|---|---|---|---|
| 1 | 0:00 | **Pong, then rewind.** Pong is loaded. Press **Run forward**, play with W / S or the arrow keys, then miss the ball (a **Halted** banner appears: the program ends when you lose). Drag the time bar back, or press **Back** / **Step**, then press a *different* key and carry on. | "This is a real machine running Pong. Time is a dial: I can scrub back through the game, change what I did, and play on from there." | Time travel on a real program. A new key press starts a new timeline. |
| 2 | 0:50 | Click **Compare engines** (top right). Press **Run forward** and watch the two cards. Then press **Measure both engines**. | "Same Pong on two engines. The left one keeps a diary of every change, and its history climbs. The right one keeps nothing: zero bytes. Both stay in exactly the same state." | The reversible engine needs no history memory; the engines agree. |
| 3 | 1:40 | Open the **Benchmarks** tab, choose **Pong**. | "The left engine's diary is deliberately naive, 48 bytes a step. The fair opponents are here. Over 200 frames of Pong: the naive diary keeps 3.65 MiB, a real bit-packed diary 24.6 KiB, checkpointing between 2.9 and 239 KiB depending on how often you snapshot, and the reversible program 1.6 KiB. But the price: it runs 3.3 times the instructions (3.0 times for the sort), measured on the hand-written assembly versions. Reversibility is a trade, and here it is." | The honest cost, with fair baselines. |
| 4 | 2:30 | Click **Back to the IDE**. Pick **sort**, press **Run forward**, then open **Compare** and read the **Garbage** line. | "A sort destroys the original order. A reversible sort cannot, so it keeps flags: that is garbage. Information is conserved; erasing is what costs." | Garbage is visible and counted. |
| 5 | 3:10 | Pick **sort** again and click **.rev** (beside the file name), then **Build and load**. Point at the **cost report** under the editor. Type a nonsense line at the end of the file and show the error appear. | "The same sort in our language is 36 lines against 340 of assembly. The compiler tells you what each line costs, and checks the reversibility rules as you type." | The cost is visible at the source level. |
| 6 | 3:50 | **Terminal.** Run `npm run demo` and press Enter through it (about 90 seconds). | "Now the debugger. 'Who last wrote this variable?' I ask by running time backwards until it changes. No log exists. History: zero bytes. Stepping back un-prints the console." | Step back is computing inverses, answered at the source line. |
| 7 | 4:50 | Back to the slide or the Pong screen. | "We did not make undoing free. We made its cost impossible to hide." | The close. |

The tour script (`examples/rev/tour.dbg`) narrates itself; the commands it runs are `where`, `break 13`, `c`, `s`, `p`, `console`, `rwatch f`,
`b`, `history` and `rc`. If you have to cut, cut beat 4, then beat 5.

## If something breaks
- **The site is down or slow:** `npm run viz` locally, or play the recording.
- **A key does nothing in Pong:** the game only gets keys while the **Output** tab is open and "Send keys to the machine" is ticked. Click the page once first.
- **The terminal tour misbehaves:** play the recording of it, or run `npm run rvm -- debug examples/rev/tour.rev` (the same program, no script) and type `where`, `s`, `p`, `rwatch f`.
- **Never** fake a number. If a figure is not ready, drop the beat.

## Numbers to have in your head (all measured; `bench/TWINS.md` has the method)
- Instructions of the reversible program against the conventional one: **3.0x** (sort), **3.3x** (Pong).
- Pong, bytes kept per frame: naive diary **19,145**, tight diary **126**, checkpoint every 10,000 steps about **15**, reversible **8** (its input log).
- Our logging engine's diary: **48 bytes a step**. It is the oracle, not a fair baseline.
- 19 instructions; two engines checked against each other after every step; about 430 tests.

## Questions we expect, and straight answers
- *"Is this new?"* The idea is old (Landauer 1961, Bennett 1973, Janus 1982, Pendulum). The complete, verified, measured stack is the work.
- *"Why is the diary 48 bytes a step?"* It is our simple diary and the correctness oracle. The tight diary (spec 12.2) is the fair baseline: the best simple
  diary we built, not a proven floor.
- *"What does reversibility cost?"* About three times the instructions, plus garbage. Both are measured (`overhead_steps`, `garbage_bits`).
- *"A tight diary is faster, so what is the point?"* Yes, it runs at full speed. But it grows with every step; the reversible machine keeps almost nothing, and a
  program is its own inverse (decrypt is the cipher run backwards, with no separate decrypt code).
- *"Does running it backwards work for Pong?"* Stepping back and scrubbing are always exact. Running the program *as its own inverse* (direction -1) is exact only
  for programs that read no input.
- *"How do you know the reversible engine is right?"* A second, independent engine that keeps a diary is run against it after every step, including random
  jumps back and forth in time, plus thousands of random programs.

## Before demo day
- Rehearse the whole thing twice, with a timer, on the machine you will present from.
- Check a clean clone: `git clone`, `npm run setup`, then `npm run demo`.
- Record the backup video.
