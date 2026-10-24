; Calls f twice; f does r2 += r1. Result: r2 = 6, stack balanced.
start:  addi r1, 3
        call f
        call f
        hlt
f:      proc f_end              ; one entry, one exit
        add  r2, r1
f_end:  ret
