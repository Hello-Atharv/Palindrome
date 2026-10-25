; Fills the screen with a gradient, one pixel at a time. The colour steps by 0x010203 on every pixel.
        .equ   FB, 0x20000
start:  xori r1, FB             ; r1 = pointer into the framebuffer
        xori r4, 2048           ; r4 = number of pixels
head:   lnd  ne, r2, r0, back   ; entered from above on the first pass, from the back edge after that
        xst  r3, [r1+0]         ; pixel ^= colour
        addi r1, 1
        addi r3, 0x010203       ; next colour
        addi r2, 1
back:   br   ne, r2, r4, head   ; back edge
        hlt
