; The same program as ifelse.s, written with macros. It assembles to exactly the same code.
; .fi's condition holds iff we came from the ELSE side; the bodies must not change r1 or r2.
start:  addi r1, 5
        addi r2, 5              ; change to 9 to take the else branch
        .if  eq, r1, r2
        addi r3, 7              ; then
        .else
        addi r3, 100            ; else
        .fi  ne, r1, r2
        hlt
