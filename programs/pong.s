; PONG, reversible, drawn on the screen. Keys: W / S or Up / Down move the paddle (hold to keep moving).
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

        .code
start:  xori   r1, 10
        roli   r1, 26                ; ball x starts at 10, moving right
        xori   r2, 8
        roli   r2, 26                ; ball y starts at 8
        xori   r3, 14
        roli   r3, 27                ; paddle starts at row 14
        xori   r4, FB+96             ; score pixels start at row 1, column 32

        ; draw the paddle
        xori   r11, 0xFFFF
        xor    r10, r3
        roli   r10, 11               ; row * 64
        xori   r10, FB
        xst    r11, [r10+0]           ; XOR paddle row 0
        xori   r10, FB
        roli   r10, 21
        xor    r10, r3
        xor    r10, r3
        xori   r12, 1
        roli   r12, 27
        add    r10, r12
        roli   r10, 11               ; row * 64
        xori   r10, FB
        xst    r11, [r10+0]           ; XOR paddle row 1
        xori   r10, FB
        roli   r10, 21
        sub    r10, r12
        roli   r12, 5
        xori   r12, 1
        xor    r10, r3
        xor    r10, r3
        xori   r12, 2
        roli   r12, 27
        add    r10, r12
        roli   r10, 11               ; row * 64
        xori   r10, FB
        xst    r11, [r10+0]           ; XOR paddle row 2
        xori   r10, FB
        roli   r10, 21
        sub    r10, r12
        roli   r12, 5
        xori   r12, 2
        xor    r10, r3
        xor    r10, r3
        xori   r12, 3
        roli   r12, 27
        add    r10, r12
        roli   r10, 11               ; row * 64
        xori   r10, FB
        xst    r11, [r10+0]           ; XOR paddle row 3
        xori   r10, FB
        roli   r10, 21
        sub    r10, r12
        roli   r12, 5
        xori   r12, 3
        xor    r10, r3
        xori   r11, 0xFFFF
        ; draw the ball
        ; r6 = folded position of phase r1 (a triangle wave); r8 = its 6-bit unfolded position
        xor    r10, r1
        roli   r10, 6
        xori   r11, 63
        toff   r8, r10, r11            ; r8 = top 6 bits of the phase
        xori   r11, 63
        roli   r10, 26
        xor    r10, r1
        xori   r12, 32
        .if    lt, r8, r12
        xor    r6, r8
        .else
        xori   r6, 63
        sub    r6, r8
        .fi    ne, r6, r8
        xori   r12, 32
        ; r7 = folded position of phase r2 (a triangle wave); r9 = its 6-bit unfolded position
        xor    r10, r2
        roli   r10, 6
        xori   r11, 63
        toff   r9, r10, r11            ; r9 = top 6 bits of the phase
        xori   r11, 63
        roli   r10, 26
        xor    r10, r2
        xori   r12, 32
        .if    lt, r9, r12
        xor    r7, r9
        .else
        xori   r7, 63
        sub    r7, r9
        .fi    ne, r7, r9
        xori   r12, 32
        ; draw the ball
        xori   r11, 0x3FFFF
        roli   r11, 6
        xori   r11, 0x3F
        xor    r10, r7
        roli   r10, 6
        add    r10, r6
        xori   r10, FB
        xst    r11, [r10+0]           ; XOR the pixel at (bx, by)
        xori   r10, FB
        sub    r10, r6
        roli   r10, 26
        xor    r10, r7
        xori   r11, 0x3F
        roli   r11, 26
        xori   r11, 0x3FFFF
        ; undo the fold of r2
        xori   r12, 32
        xori   r13, 31
        .if    lt, r9, r12
        xor    r7, r9
        .else
        add    r7, r9
        xori   r7, 63
        .fi    lt, r13, r9
        xori   r13, 31
        xori   r12, 32
        xor    r10, r2
        roli   r10, 6
        xori   r11, 63
        toff   r9, r10, r11
        xori   r11, 63
        roli   r10, 26
        xor    r10, r2
        ; undo the fold of r1
        xori   r12, 32
        xori   r13, 31
        .if    lt, r8, r12
        xor    r6, r8
        .else
        add    r6, r8
        xori   r6, 63
        .fi    lt, r13, r8
        xori   r13, 31
        xori   r12, 32
        xor    r10, r1
        roli   r10, 6
        xori   r11, 63
        toff   r8, r10, r11
        xori   r11, 63
        roli   r10, 26
        xor    r10, r1

        .loop  ne, r5, r0            ; r5 (log pointer) is 0 only on the first pass
        ; ---- 1. read the latest key event and record it ----
        xori   r7, 0x30000           ; r7 = start of the input window
        xld    r8, [r7+1]            ; r8 = number of events so far
        add    r7, r8
        xld    r6, [r7+1]            ; r6 = the latest event (0 if there is none)
        xst    r6, [r5+LOG]          ; record it

        ; erase the paddle
        xori   r11, 0xFFFF
        xor    r10, r3
        roli   r10, 11               ; row * 64
        xori   r10, FB
        xst    r11, [r10+0]           ; XOR paddle row 0
        xori   r10, FB
        roli   r10, 21
        xor    r10, r3
        xor    r10, r3
        xori   r12, 1
        roli   r12, 27
        add    r10, r12
        roli   r10, 11               ; row * 64
        xori   r10, FB
        xst    r11, [r10+0]           ; XOR paddle row 1
        xori   r10, FB
        roli   r10, 21
        sub    r10, r12
        roli   r12, 5
        xori   r12, 1
        xor    r10, r3
        xor    r10, r3
        xori   r12, 2
        roli   r12, 27
        add    r10, r12
        roli   r10, 11               ; row * 64
        xori   r10, FB
        xst    r11, [r10+0]           ; XOR paddle row 2
        xori   r10, FB
        roli   r10, 21
        sub    r10, r12
        roli   r12, 5
        xori   r12, 2
        xor    r10, r3
        xor    r10, r3
        xori   r12, 3
        roli   r12, 27
        add    r10, r12
        roli   r10, 11               ; row * 64
        xori   r10, FB
        xst    r11, [r10+0]           ; XOR paddle row 3
        xori   r10, FB
        roli   r10, 21
        sub    r10, r12
        roli   r12, 5
        xori   r12, 3
        xor    r10, r3
        xori   r11, 0xFFFF
        ; ---- 2. move the paddle: W or Up = up, S or Down = down ----
        xori   r12, 1
        roli   r12, 27
        xori   r13, 87
        .if    eq, r6, r13
        sub    r3, r12
        .fi    ne, r6, r13
        xori   r13, 87
        xori   r13, 128
        .if    eq, r6, r13
        sub    r3, r12
        .fi    ne, r6, r13
        xori   r13, 128
        xori   r13, 83
        .if    eq, r6, r13
        add    r3, r12
        .fi    ne, r6, r13
        xori   r13, 83
        xori   r13, 129
        .if    eq, r6, r13
        add    r3, r12
        .fi    ne, r6, r13
        xori   r13, 129
        roli   r12, 5
        xori   r12, 1
        ; draw the paddle
        xori   r11, 0xFFFF
        xor    r10, r3
        roli   r10, 11               ; row * 64
        xori   r10, FB
        xst    r11, [r10+0]           ; XOR paddle row 0
        xori   r10, FB
        roli   r10, 21
        xor    r10, r3
        xor    r10, r3
        xori   r12, 1
        roli   r12, 27
        add    r10, r12
        roli   r10, 11               ; row * 64
        xori   r10, FB
        xst    r11, [r10+0]           ; XOR paddle row 1
        xori   r10, FB
        roli   r10, 21
        sub    r10, r12
        roli   r12, 5
        xori   r12, 1
        xor    r10, r3
        xor    r10, r3
        xori   r12, 2
        roli   r12, 27
        add    r10, r12
        roli   r10, 11               ; row * 64
        xori   r10, FB
        xst    r11, [r10+0]           ; XOR paddle row 2
        xori   r10, FB
        roli   r10, 21
        sub    r10, r12
        roli   r12, 5
        xori   r12, 2
        xor    r10, r3
        xor    r10, r3
        xori   r12, 3
        roli   r12, 27
        add    r10, r12
        roli   r10, 11               ; row * 64
        xori   r10, FB
        xst    r11, [r10+0]           ; XOR paddle row 3
        xori   r10, FB
        roli   r10, 21
        sub    r10, r12
        roli   r12, 5
        xori   r12, 3
        xor    r10, r3
        xori   r11, 0xFFFF

        xld    r6, [r5+LOG]          ; clear the event register (the record keeps it)
        sub    r7, r8
        xori   r7, 0x30000
        xst    r8, [r5+LOG+1]        ; record the event count too, then clear it
        xld    r8, [r5+LOG+1]

        ; ---- 3. the ball ----
        ; erase the ball
        ; r6 = folded position of phase r1 (a triangle wave); r8 = its 6-bit unfolded position
        xor    r10, r1
        roli   r10, 6
        xori   r11, 63
        toff   r8, r10, r11            ; r8 = top 6 bits of the phase
        xori   r11, 63
        roli   r10, 26
        xor    r10, r1
        xori   r12, 32
        .if    lt, r8, r12
        xor    r6, r8
        .else
        xori   r6, 63
        sub    r6, r8
        .fi    ne, r6, r8
        xori   r12, 32
        ; r7 = folded position of phase r2 (a triangle wave); r9 = its 6-bit unfolded position
        xor    r10, r2
        roli   r10, 6
        xori   r11, 63
        toff   r9, r10, r11            ; r9 = top 6 bits of the phase
        xori   r11, 63
        roli   r10, 26
        xor    r10, r2
        xori   r12, 32
        .if    lt, r9, r12
        xor    r7, r9
        .else
        xori   r7, 63
        sub    r7, r9
        .fi    ne, r7, r9
        xori   r12, 32
        ; erase the ball
        xori   r11, 0x3FFFF
        roli   r11, 6
        xori   r11, 0x3F
        xor    r10, r7
        roli   r10, 6
        add    r10, r6
        xori   r10, FB
        xst    r11, [r10+0]           ; XOR the pixel at (bx, by)
        xori   r10, FB
        sub    r10, r6
        roli   r10, 26
        xor    r10, r7
        xori   r11, 0x3F
        roli   r11, 26
        xori   r11, 0x3FFFF
        ; undo the fold of r2
        xori   r12, 32
        xori   r13, 31
        .if    lt, r9, r12
        xor    r7, r9
        .else
        add    r7, r9
        xori   r7, 63
        .fi    lt, r13, r9
        xori   r13, 31
        xori   r12, 32
        xor    r10, r2
        roli   r10, 6
        xori   r11, 63
        toff   r9, r10, r11
        xori   r11, 63
        roli   r10, 26
        xor    r10, r2
        ; undo the fold of r1
        xori   r12, 32
        xori   r13, 31
        .if    lt, r8, r12
        xor    r6, r8
        .else
        add    r6, r8
        xori   r6, 63
        .fi    lt, r13, r8
        xori   r13, 31
        xori   r12, 32
        xor    r10, r1
        roli   r10, 6
        xori   r11, 63
        toff   r8, r10, r11
        xori   r11, 63
        roli   r10, 26
        xor    r10, r1
        xori   r11, 1
        roli   r11, 26
        add    r1, r11               ; move: x phase
        roli   r11, 6
        xori   r11, 1
        xori   r11, 45
        roli   r11, 20
        add    r2, r11               ; move: y phase
        roli   r11, 12
        xori   r11, 45
        ; draw the ball, and check the paddle
        ; r6 = folded position of phase r1 (a triangle wave); r8 = its 6-bit unfolded position
        xor    r10, r1
        roli   r10, 6
        xori   r11, 63
        toff   r8, r10, r11            ; r8 = top 6 bits of the phase
        xori   r11, 63
        roli   r10, 26
        xor    r10, r1
        xori   r12, 32
        .if    lt, r8, r12
        xor    r6, r8
        .else
        xori   r6, 63
        sub    r6, r8
        .fi    ne, r6, r8
        xori   r12, 32
        ; r7 = folded position of phase r2 (a triangle wave); r9 = its 6-bit unfolded position
        xor    r10, r2
        roli   r10, 6
        xori   r11, 63
        toff   r9, r10, r11            ; r9 = top 6 bits of the phase
        xori   r11, 63
        roli   r10, 26
        xor    r10, r2
        xori   r12, 32
        .if    lt, r9, r12
        xor    r7, r9
        .else
        xori   r7, 63
        sub    r7, r9
        .fi    ne, r7, r9
        xori   r12, 32
        ; draw the ball, and check the paddle
        xori   r11, 0x3FFFF
        roli   r11, 6
        xori   r11, 0x3F
        xor    r10, r7
        roli   r10, 6
        add    r10, r6
        xori   r10, FB
        xst    r11, [r10+0]           ; XOR the pixel at (bx, by)
        xori   r10, FB
        sub    r10, r6
        roli   r10, 26
        xor    r10, r7
        xori   r11, 0x3F
        roli   r11, 26
        xori   r11, 0x3FFFF
        ; contact: the ball has just arrived in the paddle column (unfolded x = 63)
        xori   r11, 63
        .if    eq, r8, r11
        xor    r13, r7                ; d = how many rows the ball is below the top of the paddle (mod 32)
        roli   r13, 27
        sub    r13, r3
        roli   r13, 5
        xori   r12, 3
        .if    lt, r12, r13           ; d > 3: the paddle is not there
        hlt                           ; game over: the machine stops (step back to carry on)
        .fi    al, r0, r0
        xori   r12, 3
        xori   r10, 0xFFFF
        roli   r10, 8
        xst    r10, [r4+0]            ; a hit: light the next score pixel
        roli   r10, 24
        xori   r10, 0xFFFF
        addi   r4, 1
        roli   r13, 27
        add    r13, r3
        roli   r13, 5
        xor    r13, r7
        .fi    ne, r8, r11
        xori   r11, 63
        ; undo the fold of r2
        xori   r12, 32
        xori   r13, 31
        .if    lt, r9, r12
        xor    r7, r9
        .else
        add    r7, r9
        xori   r7, 63
        .fi    lt, r13, r9
        xori   r13, 31
        xori   r12, 32
        xor    r10, r2
        roli   r10, 6
        xori   r11, 63
        toff   r9, r10, r11
        xori   r11, 63
        roli   r10, 26
        xor    r10, r2
        ; undo the fold of r1
        xori   r12, 32
        xori   r13, 31
        .if    lt, r8, r12
        xor    r6, r8
        .else
        add    r6, r8
        xori   r6, 63
        .fi    lt, r13, r8
        xori   r13, 31
        xori   r12, 32
        xor    r10, r1
        roli   r10, 6
        xori   r11, 63
        toff   r8, r10, r11
        xori   r11, 63
        roli   r10, 26
        xor    r10, r1

        ; ---- 4. next frame ----
        addi   r5, 2                 ; log pointer
        xld    r10, [r0+65535]       ; FRAME += 1 (move the word into a register, add, move it back)
        xst    r10, [r0+65535]
        addi   r10, 1
        xst    r10, [r0+65535]
        xld    r10, [r0+65535]
        .again al, r0, r0
