; .with, .compute / .use / .uncompute and .plot together.
; A temporary is computed, used, and cleared for us: no hand-written undo.
        .equ   FB, 0x20000
start:  addi   r1, 5                ; r1 = an input
        addi   r3, 3                ; plot position (3, 2)
        addi   r6, 2

        .compute                    ; r2 = rotl(r1, 3) + 7
        xor    r2, r1
        roli   r2, 3
        addi   r2, 7
        .use
        xst    r2, [r0+0x100]       ; memory[0x100] ^= 47
        .uncompute                  ; <- the assembler writes the inverse here; r2 is zero again

        .with  r5, 0xFFFFFF         ; r5 = white while the block runs, zero afterwards
        .plot  r5, r3, r6, r7       ; XOR the pixel (3, 2); r7 is the scratch register, zero again afterwards
        .endwith
        hlt
