; Reversible sort of 8 numbers that EXPOSES ITS GARBAGE.
;
; Sorting destroys information: [3,1,2] and [1,2,3] both become [1,2,3]. A reversible machine cannot do that
; silently, so this sort keeps a record of what it did. It is a fixed network of 19 compare-exchange steps; each
; step compares two values, swaps them if they are out of order, and files one bit away: 1 = swapped, 0 = not.
; Those 19 bits (one per word, at "garbage") are the garbage. Sorted array + garbage = the original,
; so running the program backwards (direction -1) unsorts it exactly. Look at the garbage words in the memory panel
; while you step: they fill in as the sort proceeds, and empty again when you step back.
;
; No other garbage: every temporary register ends at zero.
;
; One compare-exchange (values in ri, rj with i < j; r9 is the swap bit):
;     .if  lt, rj, ri       out of order?
;     swap ri, rj           yes: swap them
;     xori r9, 1            ... and remember that we did
;     .fi  eq, r9, r0       the bit is 0 iff we came from the "no swap" side (this is the exit assertion)
;     xst r9, [garbage+k]   file the bit away in memory ...
;     xld r9, [garbage+k]   ... and clear r9 (mem ^= r9 then r9 ^= mem leaves r9 = 0)
;
; Values are moved between memory and registers with xld then xst (no overwriting), as in cipher.s.
; Registers: r1..r8 the values, r9 swap bit, r10 garbage pointer, r11 array pointer.
        .data
arr:    .word  42, 7, 19, 3, 88, 7, 55, 1
garbage: .space 19

        .code
start:  addi   r10, garbage
        addi   r11, arr

        ; load: move each value from memory into a register (memory becomes 0)
        xld    r1, [r11+0]
        xst    r1, [r11+0]
        xld    r2, [r11+1]
        xst    r2, [r11+1]
        xld    r3, [r11+2]
        xst    r3, [r11+2]
        xld    r4, [r11+3]
        xst    r4, [r11+3]
        xld    r5, [r11+4]
        xst    r5, [r11+4]
        xld    r6, [r11+5]
        xst    r6, [r11+5]
        xld    r7, [r11+6]
        xst    r7, [r11+6]
        xld    r8, [r11+7]
        xst    r8, [r11+7]

        ; the sorting network
        .if    lt, r3, r1            ; step 1: compare-exchange (0,2)
        swap   r1, r3
        xori   r9, 1
        .fi    eq, r9, r0
        xst    r9, [r10+0]
        xld    r9, [r10+0]
        .if    lt, r4, r2            ; step 2: compare-exchange (1,3)
        swap   r2, r4
        xori   r9, 1
        .fi    eq, r9, r0
        xst    r9, [r10+1]
        xld    r9, [r10+1]
        .if    lt, r7, r5            ; step 3: compare-exchange (4,6)
        swap   r5, r7
        xori   r9, 1
        .fi    eq, r9, r0
        xst    r9, [r10+2]
        xld    r9, [r10+2]
        .if    lt, r8, r6            ; step 4: compare-exchange (5,7)
        swap   r6, r8
        xori   r9, 1
        .fi    eq, r9, r0
        xst    r9, [r10+3]
        xld    r9, [r10+3]
        .if    lt, r5, r1            ; step 5: compare-exchange (0,4)
        swap   r1, r5
        xori   r9, 1
        .fi    eq, r9, r0
        xst    r9, [r10+4]
        xld    r9, [r10+4]
        .if    lt, r6, r2            ; step 6: compare-exchange (1,5)
        swap   r2, r6
        xori   r9, 1
        .fi    eq, r9, r0
        xst    r9, [r10+5]
        xld    r9, [r10+5]
        .if    lt, r7, r3            ; step 7: compare-exchange (2,6)
        swap   r3, r7
        xori   r9, 1
        .fi    eq, r9, r0
        xst    r9, [r10+6]
        xld    r9, [r10+6]
        .if    lt, r8, r4            ; step 8: compare-exchange (3,7)
        swap   r4, r8
        xori   r9, 1
        .fi    eq, r9, r0
        xst    r9, [r10+7]
        xld    r9, [r10+7]
        .if    lt, r2, r1            ; step 9: compare-exchange (0,1)
        swap   r1, r2
        xori   r9, 1
        .fi    eq, r9, r0
        xst    r9, [r10+8]
        xld    r9, [r10+8]
        .if    lt, r4, r3            ; step 10: compare-exchange (2,3)
        swap   r3, r4
        xori   r9, 1
        .fi    eq, r9, r0
        xst    r9, [r10+9]
        xld    r9, [r10+9]
        .if    lt, r6, r5            ; step 11: compare-exchange (4,5)
        swap   r5, r6
        xori   r9, 1
        .fi    eq, r9, r0
        xst    r9, [r10+10]
        xld    r9, [r10+10]
        .if    lt, r8, r7            ; step 12: compare-exchange (6,7)
        swap   r7, r8
        xori   r9, 1
        .fi    eq, r9, r0
        xst    r9, [r10+11]
        xld    r9, [r10+11]
        .if    lt, r5, r3            ; step 13: compare-exchange (2,4)
        swap   r3, r5
        xori   r9, 1
        .fi    eq, r9, r0
        xst    r9, [r10+12]
        xld    r9, [r10+12]
        .if    lt, r6, r4            ; step 14: compare-exchange (3,5)
        swap   r4, r6
        xori   r9, 1
        .fi    eq, r9, r0
        xst    r9, [r10+13]
        xld    r9, [r10+13]
        .if    lt, r5, r2            ; step 15: compare-exchange (1,4)
        swap   r2, r5
        xori   r9, 1
        .fi    eq, r9, r0
        xst    r9, [r10+14]
        xld    r9, [r10+14]
        .if    lt, r7, r4            ; step 16: compare-exchange (3,6)
        swap   r4, r7
        xori   r9, 1
        .fi    eq, r9, r0
        xst    r9, [r10+15]
        xld    r9, [r10+15]
        .if    lt, r3, r2            ; step 17: compare-exchange (1,2)
        swap   r2, r3
        xori   r9, 1
        .fi    eq, r9, r0
        xst    r9, [r10+16]
        xld    r9, [r10+16]
        .if    lt, r5, r4            ; step 18: compare-exchange (3,4)
        swap   r4, r5
        xori   r9, 1
        .fi    eq, r9, r0
        xst    r9, [r10+17]
        xld    r9, [r10+17]
        .if    lt, r7, r6            ; step 19: compare-exchange (5,6)
        swap   r6, r7
        xori   r9, 1
        .fi    eq, r9, r0
        xst    r9, [r10+18]
        xld    r9, [r10+18]

        ; store: move each sorted value back into memory (registers become 0)
        xst    r1, [r11+0]
        xld    r1, [r11+0]
        xst    r2, [r11+1]
        xld    r2, [r11+1]
        xst    r3, [r11+2]
        xld    r3, [r11+2]
        xst    r4, [r11+3]
        xld    r4, [r11+3]
        xst    r5, [r11+4]
        xld    r5, [r11+4]
        xst    r6, [r11+5]
        xld    r6, [r11+5]
        xst    r7, [r11+6]
        xld    r7, [r11+6]
        xst    r8, [r11+7]
        xld    r8, [r11+7]

        subi   r10, garbage
        subi   r11, arr
        hlt
