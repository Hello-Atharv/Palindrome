; Reversible sort of 8 numbers that EXPOSES ITS GARBAGE, drawn on the screen.
;
; THE LIST IS ON THE SCREEN. The 8 values are colours (the red channel is the value) and they live in the framebuffer,
; so the screen itself is the visualisation: row 0 is the list, row 1 is the garbage. The program draws nothing.
; Small values are green, large ones red: when it is sorted, row 0 is a gradient. Step through and watch the
; compared pair vanish into registers and come back swapped.
;
; Sorting destroys information: [3,1,2] and [1,2,3] both become [1,2,3]. A reversible machine cannot do that silently,
; so this sort keeps a record. It is a fixed network of 19 compare-exchange steps; each compares two values, swaps them if
; they are out of order, and files one bit away on screen row 1: cyan = swapped, black = not. Those 19 pixels are the
; garbage. Sorted list + garbage = the original, so running the program backwards (direction -1) unsorts it exactly and
; clears the garbage. No other garbage: every temporary register ends at zero.
;
; One compare-exchange (list entries i < j live at screen words i and j; r9 is the swap flag):
;     xld r1,[r11+i] / xst r1,[r11+i]    move entry i off the screen into r1 (a move: nothing is overwritten)
;     xld r2,[r11+j] / xst r2,[r11+j]    same for entry j
;     .if  lt, r2, r1       out of order?
;     swap r1, r2           yes: swap them
;     xori r9, 0xFFFF       ... and set the flag
;     .fi  eq, r9, r0       flag = 0 iff we came from the "no swap" side (this is the exit assertion)
;     xst r1,[r11+i] / xld r1,[r11+i]    put them back on the screen and clear the registers
;     xst r2,[r11+j] / xld r2,[r11+j]
;     xst r9,[r10+k] / xld r9,[r10+k]    file the flag on screen row 1 and clear r9
;
; The input colours start in the data region (programs are loaded there) and are moved onto the screen first.
; Registers: r1, r2 the pair, r9 swap flag, r10 screen row 1 (garbage), r11 screen row 0 (the list).
        .equ   FB, 0x20000
        .data
arr:    .word  0xb04f40, 0x30cf40, 0x708f40, 0x20df40, 0xf00f40, 0x30cf40, 0xc03f40, 0x10ef40

        .code
start:  xori   r11, FB              ; r11 = screen row 0
        xori   r10, FB+64           ; r10 = screen row 1

        ; move the input from the data region onto the screen (data becomes 0)
        xld    r1, [r0+0]
        xst    r1, [r0+0]
        xst    r1, [r11+0]
        xld    r1, [r11+0]
        xld    r1, [r0+1]
        xst    r1, [r0+1]
        xst    r1, [r11+1]
        xld    r1, [r11+1]
        xld    r1, [r0+2]
        xst    r1, [r0+2]
        xst    r1, [r11+2]
        xld    r1, [r11+2]
        xld    r1, [r0+3]
        xst    r1, [r0+3]
        xst    r1, [r11+3]
        xld    r1, [r11+3]
        xld    r1, [r0+4]
        xst    r1, [r0+4]
        xst    r1, [r11+4]
        xld    r1, [r11+4]
        xld    r1, [r0+5]
        xst    r1, [r0+5]
        xst    r1, [r11+5]
        xld    r1, [r11+5]
        xld    r1, [r0+6]
        xst    r1, [r0+6]
        xst    r1, [r11+6]
        xld    r1, [r11+6]
        xld    r1, [r0+7]
        xst    r1, [r0+7]
        xst    r1, [r11+7]
        xld    r1, [r11+7]

        ; the sorting network, working directly on the screen
        xld    r1, [r11+0]               ; step 1: compare-exchange (0,2)
        xst    r1, [r11+0]
        xld    r2, [r11+2]
        xst    r2, [r11+2]
        .if    lt, r2, r1
        swap   r1, r2
        xori   r9, 0xFFFF
        .fi    eq, r9, r0
        xst    r1, [r11+0]
        xld    r1, [r11+0]
        xst    r2, [r11+2]
        xld    r2, [r11+2]
        xst    r9, [r10+0]
        xld    r9, [r10+0]
        xld    r1, [r11+1]               ; step 2: compare-exchange (1,3)
        xst    r1, [r11+1]
        xld    r2, [r11+3]
        xst    r2, [r11+3]
        .if    lt, r2, r1
        swap   r1, r2
        xori   r9, 0xFFFF
        .fi    eq, r9, r0
        xst    r1, [r11+1]
        xld    r1, [r11+1]
        xst    r2, [r11+3]
        xld    r2, [r11+3]
        xst    r9, [r10+1]
        xld    r9, [r10+1]
        xld    r1, [r11+4]               ; step 3: compare-exchange (4,6)
        xst    r1, [r11+4]
        xld    r2, [r11+6]
        xst    r2, [r11+6]
        .if    lt, r2, r1
        swap   r1, r2
        xori   r9, 0xFFFF
        .fi    eq, r9, r0
        xst    r1, [r11+4]
        xld    r1, [r11+4]
        xst    r2, [r11+6]
        xld    r2, [r11+6]
        xst    r9, [r10+2]
        xld    r9, [r10+2]
        xld    r1, [r11+5]               ; step 4: compare-exchange (5,7)
        xst    r1, [r11+5]
        xld    r2, [r11+7]
        xst    r2, [r11+7]
        .if    lt, r2, r1
        swap   r1, r2
        xori   r9, 0xFFFF
        .fi    eq, r9, r0
        xst    r1, [r11+5]
        xld    r1, [r11+5]
        xst    r2, [r11+7]
        xld    r2, [r11+7]
        xst    r9, [r10+3]
        xld    r9, [r10+3]
        xld    r1, [r11+0]               ; step 5: compare-exchange (0,4)
        xst    r1, [r11+0]
        xld    r2, [r11+4]
        xst    r2, [r11+4]
        .if    lt, r2, r1
        swap   r1, r2
        xori   r9, 0xFFFF
        .fi    eq, r9, r0
        xst    r1, [r11+0]
        xld    r1, [r11+0]
        xst    r2, [r11+4]
        xld    r2, [r11+4]
        xst    r9, [r10+4]
        xld    r9, [r10+4]
        xld    r1, [r11+1]               ; step 6: compare-exchange (1,5)
        xst    r1, [r11+1]
        xld    r2, [r11+5]
        xst    r2, [r11+5]
        .if    lt, r2, r1
        swap   r1, r2
        xori   r9, 0xFFFF
        .fi    eq, r9, r0
        xst    r1, [r11+1]
        xld    r1, [r11+1]
        xst    r2, [r11+5]
        xld    r2, [r11+5]
        xst    r9, [r10+5]
        xld    r9, [r10+5]
        xld    r1, [r11+2]               ; step 7: compare-exchange (2,6)
        xst    r1, [r11+2]
        xld    r2, [r11+6]
        xst    r2, [r11+6]
        .if    lt, r2, r1
        swap   r1, r2
        xori   r9, 0xFFFF
        .fi    eq, r9, r0
        xst    r1, [r11+2]
        xld    r1, [r11+2]
        xst    r2, [r11+6]
        xld    r2, [r11+6]
        xst    r9, [r10+6]
        xld    r9, [r10+6]
        xld    r1, [r11+3]               ; step 8: compare-exchange (3,7)
        xst    r1, [r11+3]
        xld    r2, [r11+7]
        xst    r2, [r11+7]
        .if    lt, r2, r1
        swap   r1, r2
        xori   r9, 0xFFFF
        .fi    eq, r9, r0
        xst    r1, [r11+3]
        xld    r1, [r11+3]
        xst    r2, [r11+7]
        xld    r2, [r11+7]
        xst    r9, [r10+7]
        xld    r9, [r10+7]
        xld    r1, [r11+0]               ; step 9: compare-exchange (0,1)
        xst    r1, [r11+0]
        xld    r2, [r11+1]
        xst    r2, [r11+1]
        .if    lt, r2, r1
        swap   r1, r2
        xori   r9, 0xFFFF
        .fi    eq, r9, r0
        xst    r1, [r11+0]
        xld    r1, [r11+0]
        xst    r2, [r11+1]
        xld    r2, [r11+1]
        xst    r9, [r10+8]
        xld    r9, [r10+8]
        xld    r1, [r11+2]               ; step 10: compare-exchange (2,3)
        xst    r1, [r11+2]
        xld    r2, [r11+3]
        xst    r2, [r11+3]
        .if    lt, r2, r1
        swap   r1, r2
        xori   r9, 0xFFFF
        .fi    eq, r9, r0
        xst    r1, [r11+2]
        xld    r1, [r11+2]
        xst    r2, [r11+3]
        xld    r2, [r11+3]
        xst    r9, [r10+9]
        xld    r9, [r10+9]
        xld    r1, [r11+4]               ; step 11: compare-exchange (4,5)
        xst    r1, [r11+4]
        xld    r2, [r11+5]
        xst    r2, [r11+5]
        .if    lt, r2, r1
        swap   r1, r2
        xori   r9, 0xFFFF
        .fi    eq, r9, r0
        xst    r1, [r11+4]
        xld    r1, [r11+4]
        xst    r2, [r11+5]
        xld    r2, [r11+5]
        xst    r9, [r10+10]
        xld    r9, [r10+10]
        xld    r1, [r11+6]               ; step 12: compare-exchange (6,7)
        xst    r1, [r11+6]
        xld    r2, [r11+7]
        xst    r2, [r11+7]
        .if    lt, r2, r1
        swap   r1, r2
        xori   r9, 0xFFFF
        .fi    eq, r9, r0
        xst    r1, [r11+6]
        xld    r1, [r11+6]
        xst    r2, [r11+7]
        xld    r2, [r11+7]
        xst    r9, [r10+11]
        xld    r9, [r10+11]
        xld    r1, [r11+2]               ; step 13: compare-exchange (2,4)
        xst    r1, [r11+2]
        xld    r2, [r11+4]
        xst    r2, [r11+4]
        .if    lt, r2, r1
        swap   r1, r2
        xori   r9, 0xFFFF
        .fi    eq, r9, r0
        xst    r1, [r11+2]
        xld    r1, [r11+2]
        xst    r2, [r11+4]
        xld    r2, [r11+4]
        xst    r9, [r10+12]
        xld    r9, [r10+12]
        xld    r1, [r11+3]               ; step 14: compare-exchange (3,5)
        xst    r1, [r11+3]
        xld    r2, [r11+5]
        xst    r2, [r11+5]
        .if    lt, r2, r1
        swap   r1, r2
        xori   r9, 0xFFFF
        .fi    eq, r9, r0
        xst    r1, [r11+3]
        xld    r1, [r11+3]
        xst    r2, [r11+5]
        xld    r2, [r11+5]
        xst    r9, [r10+13]
        xld    r9, [r10+13]
        xld    r1, [r11+1]               ; step 15: compare-exchange (1,4)
        xst    r1, [r11+1]
        xld    r2, [r11+4]
        xst    r2, [r11+4]
        .if    lt, r2, r1
        swap   r1, r2
        xori   r9, 0xFFFF
        .fi    eq, r9, r0
        xst    r1, [r11+1]
        xld    r1, [r11+1]
        xst    r2, [r11+4]
        xld    r2, [r11+4]
        xst    r9, [r10+14]
        xld    r9, [r10+14]
        xld    r1, [r11+3]               ; step 16: compare-exchange (3,6)
        xst    r1, [r11+3]
        xld    r2, [r11+6]
        xst    r2, [r11+6]
        .if    lt, r2, r1
        swap   r1, r2
        xori   r9, 0xFFFF
        .fi    eq, r9, r0
        xst    r1, [r11+3]
        xld    r1, [r11+3]
        xst    r2, [r11+6]
        xld    r2, [r11+6]
        xst    r9, [r10+15]
        xld    r9, [r10+15]
        xld    r1, [r11+1]               ; step 17: compare-exchange (1,2)
        xst    r1, [r11+1]
        xld    r2, [r11+2]
        xst    r2, [r11+2]
        .if    lt, r2, r1
        swap   r1, r2
        xori   r9, 0xFFFF
        .fi    eq, r9, r0
        xst    r1, [r11+1]
        xld    r1, [r11+1]
        xst    r2, [r11+2]
        xld    r2, [r11+2]
        xst    r9, [r10+16]
        xld    r9, [r10+16]
        xld    r1, [r11+3]               ; step 18: compare-exchange (3,4)
        xst    r1, [r11+3]
        xld    r2, [r11+4]
        xst    r2, [r11+4]
        .if    lt, r2, r1
        swap   r1, r2
        xori   r9, 0xFFFF
        .fi    eq, r9, r0
        xst    r1, [r11+3]
        xld    r1, [r11+3]
        xst    r2, [r11+4]
        xld    r2, [r11+4]
        xst    r9, [r10+17]
        xld    r9, [r10+17]
        xld    r1, [r11+5]               ; step 19: compare-exchange (5,6)
        xst    r1, [r11+5]
        xld    r2, [r11+6]
        xst    r2, [r11+6]
        .if    lt, r2, r1
        swap   r1, r2
        xori   r9, 0xFFFF
        .fi    eq, r9, r0
        xst    r1, [r11+5]
        xld    r1, [r11+5]
        xst    r2, [r11+6]
        xld    r2, [r11+6]
        xst    r9, [r10+18]
        xld    r9, [r10+18]

        xori   r10, FB+64           ; clean up the two screen pointers
        xori   r11, FB
        hlt
