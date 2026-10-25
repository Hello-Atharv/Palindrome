; PONG, reversible, drawn on the screen. Keys: W / S or Up / Down move the paddle (hold to keep moving).
;
; The court is the left half of the screen (32 x 32). The paddle is on the left edge (column 0, 4 rows tall, cyan);
; the ball is white. Each time the ball comes back to the left edge, if the paddle is there it is a hit and a yellow
; SCORE block lights up on rows 1-2 of the right half (one block per hit); if the paddle is not there the program
; halts: game over. The machine stops, and stepping back resumes the game, which is the point.
;
; HOW IT STAYS REVERSIBLE (and what it costs)
;  * The ball has no bounce logic. Each axis keeps an UNFOLDED position (a 32-bit phase that wraps by itself); the screen
;    position is its triangle-wave fold. A bounce is just the fold turning round, so no decision is made, nothing is lost.
;  * Drawing is XOR: the same instruction draws and erases. Each frame erases the paddle and ball, moves them, redraws.
;  * The fold procedures XOR their results into the registers, so calling one twice clears what the first call set. The
;    ball's old position is cleared with the OLD phase, then the phase moves, then the new position is set.
;  * Temporaries are built with .with / .compute and cleared by .endwith / .uncompute (the assembler writes the undo).
;    Between frames every temporary register is zero.
;  * INPUT IS THE ONE THING THAT MUST BE RECORDED. Each frame the latest key event and the event count are filed in a log
;    (data memory from 0x1000, two words per frame). That log is this program's garbage: 8 bytes a frame (zero while nobody
;    presses a key), against 48 bytes PER STEP, about 19 KB a frame, that the diary engine needs for the same program.
;  * Simplification: the paddle wraps round the top and bottom instead of stopping at the edge. Stopping it would need one
;    more recorded bit for every blocked move.
;  * FRAME (data word 0xFFFF) is incremented once per frame, so a debugger can step by frame.
;
; Registers (persistent): r1 ball x phase, r2 ball y phase, r3 paddle phase, r4 next score block, r5 log pointer,
;                         r6 bx, r7 by (the ball's folded screen position), r8 qx (its unfolded x, 0..63).
; r9..r13 and r15 are temporaries, zero between frames. The procedures below clobber r10..r13 and r15.
        .equ   LOG, 0x1000
        .equ   CYAN, 0x00FFFF
        .equ   WHITE, 0xFFFFFF
        .equ   YELLOW, 0xFFFF00
        .equ   ROW, 0x8000000          ; one paddle row in the paddle's phase (1 << 27)

start:  xori   r1, 10
        roli   r1, 26                   ; ball x starts at 10, moving right
        xori   r2, 8
        roli   r2, 26                   ; ball y starts at 8
        xori   r3, 14
        roli   r3, 27                   ; paddle starts at row 14
        xori   r4, 0x20060              ; score blocks start at row 1, column 32
        call   fold_x                   ; set bx, qx
        call   fold_y                   ; set by
        call   draw_paddle
        call   draw_ball

        .loop  ne, r5, r0               ; r5 (log pointer) is 0 only on the first pass
        ; ---- the paddle: read the latest key event, record it, move ----
        call   draw_paddle              ; erase
        xori   r11, 0x30000             ; r11 = start of the input window
        xld    r12, [r11+1]             ; r12 = number of events so far
        add    r11, r12
        xld    r10, [r11+1]             ; r10 = the latest event (0 if none)
        xst    r10, [r5+LOG]            ; record it
        .with  r15, ROW
        .with  r13, 0x57                ; W
        .if    eq, r10, r13
        sub    r3, r15
        .fi    ne, r10, r13
        .endwith
        .with  r13, 0x80                ; Up
        .if    eq, r10, r13
        sub    r3, r15
        .fi    ne, r10, r13
        .endwith
        .with  r13, 0x53                ; S
        .if    eq, r10, r13
        add    r3, r15
        .fi    ne, r10, r13
        .endwith
        .with  r13, 0x81                ; Down
        .if    eq, r10, r13
        add    r3, r15
        .fi    ne, r10, r13
        .endwith
        .endwith
        xld    r10, [r5+LOG]            ; clear the event register (the record keeps it)
        sub    r11, r12
        xori   r11, 0x30000
        xst    r12, [r5+LOG+1]          ; record the event count too, then clear it
        xld    r12, [r5+LOG+1]
        call   draw_paddle              ; draw

        ; ---- the ball: erase, move, draw ----
        call   draw_ball                ; erase
        call   fold_x                   ; clear bx, qx (they hold the old position)
        call   fold_y                   ; clear by
        .with  r11, 0x4000000           ; 1 column per frame
        add    r1, r11
        .endwith
        .with  r11, 0x2D00000           ; 45/64 of a row per frame
        add    r2, r11
        .endwith
        call   fold_x                   ; set the new bx, qx
        call   fold_y                   ; set the new by
        call   draw_ball                ; draw

        ; ---- contact: the ball has just arrived in the paddle column (unfolded x = 63) ----
        .with  r11, 63
        .if    eq, r8, r11
        .compute                        ; r13 = how many rows the ball is below the top of the paddle (mod 32)
        xor    r13, r7
        roli   r13, 27
        sub    r13, r3
        roli   r13, 5
        .use
        .with  r12, 3
        .if    lt, r12, r13             ; more than 3 rows below the top: the paddle is not there
        hlt                             ; game over: the machine stops (step back to carry on)
        .fi    al, r0, r0
        .endwith
        .with  r10, YELLOW              ; a hit: light a 2 x 2 score block
        xst    r10, [r4+0]
        xst    r10, [r4+1]
        xst    r10, [r4+64]
        xst    r10, [r4+65]
        .endwith
        addi   r4, 3
        .uncompute
        .fi    ne, r8, r11
        .endwith

        ; ---- next frame ----
        addi   r5, 2                    ; log pointer
        xld    r10, [r0+65535]          ; FRAME += 1 (move the word into a register, add, move it back)
        xst    r10, [r0+65535]
        addi   r10, 1
        xst    r10, [r0+65535]
        xld    r10, [r0+65535]
        .again al, r0, r0

; ---- procedures ---------------------------------------------------------------------------------------------------

; XOR the 4 paddle pixels (cyan): draws the paddle if it is not there, erases it if it is.
draw_paddle: proc draw_paddle_end
        .with  r11, CYAN
        .with  r13, 0
        .compute                        ; r12 = row of paddle pixel 0 (the paddle phase's top 5 bits)
        xor    r12, r3
        add    r12, r13
        roli   r12, 5
        .use
        .plot  r11, r0, r12, r10        ; column 0
        .uncompute
        .endwith
        .with  r13, ROW
        .compute
        xor    r12, r3
        add    r12, r13
        roli   r12, 5
        .use
        .plot  r11, r0, r12, r10
        .uncompute
        .endwith
        .with  r13, 0x10000000
        .compute
        xor    r12, r3
        add    r12, r13
        roli   r12, 5
        .use
        .plot  r11, r0, r12, r10
        .uncompute
        .endwith
        .with  r13, 0x18000000
        .compute
        xor    r12, r3
        add    r12, r13
        roli   r12, 5
        .use
        .plot  r11, r0, r12, r10
        .uncompute
        .endwith
        .endwith
draw_paddle_end: ret

; XOR the ball pixel (white) at (bx, by).
draw_ball: proc draw_ball_end
        .with  r11, WHITE
        .plot  r11, r6, r7, r10
        .endwith
draw_ball_end: ret

; bx ^= fold(px), qx ^= unfolded(px). Results are XORed in, so calling it twice clears them. The unfolded position u is the
; top 6 bits of the phase (0..63); the fold is u when u < 32 and 63 - u when u >= 32, which is u ^ (63 * bit 5 of u).
fold_x: proc fold_x_end
        .with  r11, 63
        .compute                        ; r12 = u
        xor    r10, r1
        roli   r10, 6
        toff   r12, r10, r11
        roli   r10, 26
        xor    r10, r1
        .use
        xor    r8, r12                  ; qx ^= u
        .compute                        ; r13 = 63 * bit 5 of u
        xor    r10, r12
        roli   r10, 27
        .with  r13, 1
        toff   r15, r10, r13
        .endwith
        roli   r10, 5
        xor    r10, r12
        xor    r13, r15
        roli   r13, 6
        sub    r13, r15
        .use
        xor    r6, r12                  ; bx ^= u ^ (63 * bit 5)
        xor    r6, r13
        .uncompute
        .uncompute
        .endwith
fold_x_end: ret

; by ^= fold(py).
fold_y: proc fold_y_end
        .with  r11, 63
        .compute
        xor    r10, r2
        roli   r10, 6
        toff   r12, r10, r11
        roli   r10, 26
        xor    r10, r2
        .use
        .compute
        xor    r10, r12
        roli   r10, 27
        .with  r13, 1
        toff   r15, r10, r13
        .endwith
        roli   r10, 5
        xor    r10, r12
        xor    r13, r15
        roli   r13, 6
        sub    r13, r15
        .use
        xor    r7, r12
        xor    r7, r13
        .uncompute
        .uncompute
        .endwith
fold_y_end: ret
