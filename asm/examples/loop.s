; r3 = 4 * 4, as a loop. The head asserts "arrived by the back edge iff r2 != 0".
start:  addi r1, 4
head:   lnd  ne, r2, r0, back
        add  r3, r1
        addi r2, 1
back:   br   ne, r2, r1, head   ; back edge
        hlt
