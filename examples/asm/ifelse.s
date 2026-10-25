; if (r1 == r2) r3 += 7 else r3 += 100       (SPEC section 6 worked example)
start:  addi r1, 5
        addi r2, 5              ; change to 9 to take the else branch
S0:     br   eq, r1, r2, Lthen  ; entry test
        addi r3, 100            ; else body (must not change r1, r2)
S1:     br   al, Lend
Lthen:  lnd  al, r0, r0, S0     ; reached only by the jump from S0
        addi r3, 7              ; then body (must not change r1, r2)
Lend:   lnd  ne, r1, r2, S1     ; true iff we came from the else side
        hlt
