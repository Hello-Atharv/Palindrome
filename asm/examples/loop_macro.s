; The same program as loop.s, written with macros. It assembles to exactly the same code.
; .loop's condition holds iff we arrived by the back edge; .again repeats while its condition holds.
start:  addi r1, 4
        .loop  ne, r2, r0
        add  r3, r1
        addi r2, 1
        .again ne, r2, r1
        hlt
