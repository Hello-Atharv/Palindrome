// Generates programs/pong.s. Run: node programs/tools/gen_pong.mjs
// The program repeats a few patterns many times (build a constant, XOR-draw, fold a phase), so it is generated.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const lines = [];
const L = (s = '') => lines.push(s === '' ? '' : '        ' + s);
const C = (s) => lines.push(s); // comments and labels, unindented

// ---- building constants in a zero register, and clearing them again (everything is undoable) ----------------
const inv = (m, v) => (m === 'roli' ? (32 - v) % 32 : v);
const on = (reg, ops) => ops.forEach(([m, v]) => L(`${m.padEnd(6)} ${reg}, ${v}`));
const off = (reg, ops) => [...ops].reverse().forEach(([m, v]) => L(`${m.padEnd(6)} ${reg}, ${inv(m, v)}`));
const WHITE = [['xori', '0x3FFFF'], ['roli', 6], ['xori', '0x3F']]; // 0xFFFFFF
const CYAN = [['xori', '0xFFFF']];
const YELLOW = [['xori', '0xFFFF'], ['roli', 8]]; // 0xFFFF00
const STEP = [['xori', 1], ['roli', 27]]; // one paddle row
const VX = [['xori', 1], ['roli', 26]]; // ball: 1 column per frame
const VY = [['xori', 45], ['roli', 20]]; // ball: 45/64 rows per frame
const KK = (k) => [['xori', k], ['roli', 27]]; // k rows

// Registers. Persistent: r1 px, r2 py (ball phases), r3 pp (paddle phase), r4 hpos (score pixel), r5 lp (log pointer).
// Between phases every other register is zero. Temporaries: r6 bx, r7 by, r8 qx, r9 qy, r10 t/a, r11 k1/c, r12 k2, r13 k3.

function foldCompute(P, q, b) {
  C(`        ; ${b} = folded position of phase ${P} (a triangle wave); ${q} = its 6-bit unfolded position`);
  L(`xor    r10, ${P}`);
  L('roli   r10, 6');
  L('xori   r11, 63');
  L(`toff   ${q}, r10, r11            ; ${q} = top 6 bits of the phase`);
  L('xori   r11, 63');
  L('roli   r10, 26');
  L(`xor    r10, ${P}`);
  L('xori   r12, 32');
  L(`.if    lt, ${q}, r12`);
  L(`xor    ${b}, ${q}`);
  L('.else');
  L(`xori   ${b}, 63`);
  L(`sub    ${b}, ${q}`);
  L(`.fi    ne, ${b}, ${q}`);
  L('xori   r12, 32');
}

function foldUncompute(P, q, b) {
  C(`        ; undo the fold of ${P}`);
  L('xori   r12, 32');
  L('xori   r13, 31');
  L(`.if    lt, ${q}, r12`);
  L(`xor    ${b}, ${q}`);
  L('.else');
  L(`add    ${b}, ${q}`);
  L(`xori   ${b}, 63`);
  L(`.fi    lt, r13, ${q}`);
  L('xori   r13, 31');
  L('xori   r12, 32');
  L('xor    r10, ' + P);
  L('roli   r10, 6');
  L('xori   r11, 63');
  L(`toff   ${q}, r10, r11`);
  L('xori   r11, 63');
  L('roli   r10, 26');
  L(`xor    r10, ${P}`);
}

function drawBall(note) {
  C(`        ; ${note}`);
  on('r11', WHITE);
  L('xor    r10, r7');
  L('roli   r10, 6');
  L('add    r10, r6');
  L('xori   r10, FB');
  L('xst    r11, [r10+0]           ; XOR the pixel at (bx, by)');
  L('xori   r10, FB');
  L('sub    r10, r6');
  L('roli   r10, 26');
  L('xor    r10, r7');
  off('r11', WHITE);
}

function drawPaddle(note) {
  C(`        ; ${note}`);
  on('r11', CYAN);
  for (let k = 0; k < 4; k++) {
    L('xor    r10, r3');
    if (k) {
      on('r12', KK(k));
      L('add    r10, r12');
    }
    L('roli   r10, 11               ; row * 64');
    L('xori   r10, FB');
    L('xst    r11, [r10+0]           ' + `; XOR paddle row ${k}`);
    L('xori   r10, FB');
    L('roli   r10, 21');
    if (k) {
      L('sub    r10, r12');
      off('r12', KK(k));
    }
    L('xor    r10, r3');
  }
  off('r11', CYAN);
}

function ballAt(note, withContact) {
  C(`        ; ${note}`);
  foldCompute('r1', 'r8', 'r6');
  foldCompute('r2', 'r9', 'r7');
  drawBall(note);
  if (withContact) {
    C('        ; contact: the ball has just arrived in the paddle column (unfolded x = 63)');
    L('xori   r11, 63');
    L('.if    eq, r8, r11');
    L('xor    r13, r7                ; d = how many rows the ball is below the top of the paddle (mod 32)');
    L('roli   r13, 27');
    L('sub    r13, r3');
    L('roli   r13, 5');
    L('xori   r12, 3');
    L('.if    lt, r12, r13           ; d > 3: the paddle is not there');
    L('hlt                           ; game over: the machine stops (step back to carry on)');
    L('.fi    al, r0, r0');
    L('xori   r12, 3');
    on('r10', YELLOW);
    L('xst    r10, [r4+0]            ; a hit: light the next score pixel');
    off('r10', YELLOW);
    L('addi   r4, 1');
    L('roli   r13, 27');
    L('add    r13, r3');
    L('roli   r13, 5');
    L('xor    r13, r7');
    L('.fi    ne, r8, r11');
    L('xori   r11, 63');
  }
  foldUncompute('r2', 'r9', 'r7');
  foldUncompute('r1', 'r8', 'r6');
}

C(`; PONG, reversible, drawn on the screen. Keys: W / S or Up / Down move the paddle (hold to keep moving).
;
; The court is the left half of the screen (32 x 32). The paddle is on the left edge (column 0, 4 rows tall, cyan);
; the ball is white. Each time the ball comes back to the left edge, if the paddle is there it is a hit and a yellow
; score pixel lights up on row 1 (right half); if not, the program halts: game over. The machine stops, and stepping
; back resumes the game, which is the point.
;
; HOW IT STAYS REVERSIBLE (and what it costs)
;  * The ball has no bounce logic. Each axis keeps an UNFOLDED position that just keeps counting (a 32-bit phase that
;    wraps by itself); the screen position is its triangle-wave fold. A bounce is just the fold turning round, so no
;    decision is made and nothing is lost. (Billiards is reversible for the same reason.)
;  * Drawing is XOR: the same instruction draws and erases. Each frame erases the old ball and paddle, moves them,
;    and draws them again.
;  * Derived values (the folded position, drawing addresses, constants) are computed into zeroed registers, used,
;    then UNCOMPUTED back to zero. At the end of every frame all temporaries are zero.
;  * INPUT IS THE ONE THING THAT MUST BE RECORDED. Each frame the program reads the latest key event from the input
;    window and files it, with the event count, into a log (data memory from 0x1000, two words per frame). That log is
;    this program's garbage: about 8 bytes a frame, against the 48 bytes PER STEP (about 20 KB a frame) that the
;    diary engine needs for the same program.
;  * Simplification: the paddle wraps round the top and bottom instead of stopping at the edge. Stopping it would
;    need one more recorded bit for every blocked move.
;  * FRAME (data word 0xFFFF) is incremented once per frame, so a debugger can step by frame.
;
; Registers: r1 ball x phase, r2 ball y phase, r3 paddle phase, r4 score pixel pointer, r5 log pointer (all persistent);
; r6 bx, r7 by (folded ball position), r8 qx, r9 qy (unfolded), r10..r13 temporaries.
        .equ   FB, 0x20000
        .equ   LOG, 0x1000

        .code`);

// ---- setup: initial state, and the first drawing of the paddle and the ball --------------------------------------
C('start:  xori   r1, 10');
L('roli   r1, 26                ; ball x starts at 10, moving right');
L('xori   r2, 8');
L('roli   r2, 26                ; ball y starts at 8');
L('xori   r3, 14');
L('roli   r3, 27                ; paddle starts at row 14');
L('xori   r4, FB+96             ; score pixels start at row 1, column 32');
L('');
drawPaddle('draw the paddle');
ballAt('draw the ball', false);
L('');

// ---- one frame per pass -----------------------------------------------------------------------------------------
L('.loop  ne, r5, r0            ; r5 (log pointer) is 0 only on the first pass');
C('        ; ---- 1. read the latest key event and record it ----');
L('xori   r7, 0x30000           ; r7 = start of the input window');
L('xld    r8, [r7+1]            ; r8 = number of events so far');
L('add    r7, r8');
L('xld    r6, [r7+1]            ; r6 = the latest event (0 if there is none)');
L('xst    r6, [r5+LOG]          ; record it');
L('');
drawPaddle('erase the paddle');
C('        ; ---- 2. move the paddle: W or Up = up, S or Down = down ----');
on('r12', STEP);
for (const [key, op] of [[0x57, 'sub'], [0x80, 'sub'], [0x53, 'add'], [0x81, 'add']]) {
  L(`xori   r13, ${key}`);
  L('.if    eq, r6, r13');
  L(`${op}    r3, r12`);
  L('.fi    ne, r6, r13');
  L(`xori   r13, ${key}`);
}
off('r12', STEP);
drawPaddle('draw the paddle');
L('');
L('xld    r6, [r5+LOG]          ; clear the event register (the record keeps it)');
L('sub    r7, r8');
L('xori   r7, 0x30000');
L('xst    r8, [r5+LOG+1]        ; record the event count too, then clear it');
L('xld    r8, [r5+LOG+1]');
L('');
C('        ; ---- 3. the ball ----');
ballAt('erase the ball', false);
on('r11', VX);
L('add    r1, r11               ; move: x phase');
off('r11', VX);
on('r11', VY);
L('add    r2, r11               ; move: y phase');
off('r11', VY);
ballAt('draw the ball, and check the paddle', true);
L('');
C('        ; ---- 4. next frame ----');
L('addi   r5, 2                 ; log pointer');
L('xld    r10, [r0+65535]       ; FRAME += 1 (move the word into a register, add, move it back)');
L('xst    r10, [r0+65535]');
L('addi   r10, 1');
L('xst    r10, [r0+65535]');
L('xld    r10, [r0+65535]');
L('.again al, r0, r0');

const out = fileURLToPath(new URL('../pong.s', import.meta.url));
writeFileSync(out, lines.join('\n') + '\n');
console.log(`wrote ${out} (${lines.length} lines)`);
