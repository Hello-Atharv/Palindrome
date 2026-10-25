; A loop with an if inside. i = r2 counts 1..5; r5 counts the iterations where i == 3, r6 the others.
; Result: r2 = 5, r5 = 1, r6 = 4.
start:  addi r1, 5              ; limit
        addi r4, 3              ; special value
        .loop  ne, r2, r0       ; true only when arriving by the back edge (r2 starts at 0)
        addi r2, 1
        .if    eq, r2, r4       ; the bodies below do not touch r2 or r4
        addi r5, 1
        .else
        addi r6, 1
        .fi    ne, r2, r4       ; true iff we came from the else side
        .again ne, r2, r1
        hlt
