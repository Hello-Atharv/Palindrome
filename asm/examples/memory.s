; Data section, constants, xor-load and xor-store into the framebuffer.
        .equ FB, 0x20000
        .data
msg:    .word 0xDEAD, 0xBEEF
pad:    .space 2
        .code
start:  xori r1, FB             ; r1 = framebuffer base (xori is zero-extended)
        addi r2, msg            ; r2 = address of msg (data label)
        xld  r3, [r2+0]         ; r3 = 0xDEAD
        xld  r4, [r2+1]         ; r4 = 0xBEEF
        xst  r3, [r1+5]         ; framebuffer word 5  = 0xDEAD
        xst  r4, [r1+6]         ; framebuffer word 6  = 0xBEEF
        xst  r3, [r1+5]         ; xor again: draws then erases, word 5 back to 0
        neg  r4                 ; r4 = -0xBEEF
        hlt
