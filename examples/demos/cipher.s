; Reversible cipher: Speck64/128 (a published add-rotate-xor cipher) encrypting a 32-character message in place, ON THE SCREEN.
; Run it with direction -1 and the same program decrypts. It matches the official test vector (see the tests).
;
; THE MESSAGE IS ON THE SCREEN. The program first moves the 8 message words out of the data region and onto the
; screen (framebuffer words are pixels), then encrypts them there. You see 8 dull grey-blue pixels (the plaintext) turn
; into 8 random colours (the ciphertext); run it in reverse and they turn back. The program draws nothing.
;
; Speck round on a block (x, y) with round key k:   x = (rotr(x, 8) + y) ^ k      y = rotl(y, 3) ^ x
; Every operation is a bijection, so the whole program is one, and running it backwards is decryption.
; No garbage: every temporary register is returned to zero.
;
; Moving a word from memory a to memory b without overwriting anything (r3 starts at 0):
;     xld r3, [a]      r3 ^= mem a   ->  r3 = word
;     xst r3, [a]      mem a ^= r3   ->  a = 0            (so far a move into r3)
;     xst r3, [b]      mem b ^= r3   ->  b = word         (b was 0)
;     xld r3, [b]      r3 ^= mem b   ->  r3 = 0           (the copy is uncomputed)
;
; The 27 round keys below were expanded offline from the key 1b1a1918 13121110 0b0a0908 03020100.
; Registers: r6 message pointer (data), r1 screen pointer, r2 its end, r11 screen start, r3/r4 the block (x, y),
;            r8 round pointer, r9 round key, r10 round count.
        .equ   ROUNDS, 27
        .equ   FB, 0x20000

        .data
rk:     .word  0x03020100, 0x131d0309, 0xbbd80d53
        .word  0x0d334df3, 0x7fa43565, 0x67e6ce55
        .word  0xe98cb3d2, 0xaac76cbd, 0x7f5951c8
        .word  0x03fa82c2, 0x313533ad, 0xdff70882
        .word  0x9e487c93, 0xa934b928, 0xdd2edef5
        .word  0x8be6388d, 0x1f706b89, 0x2b87aaf8
        .word  0x12d76c17, 0x6eaccd6c, 0x6a1ab912
        .word  0x10bc6bca, 0x6057dd32, 0xd3c9b381
        .word  0xb347813d, 0x8c113c35, 0xfe6b523a
; "NOTHING IS EVER THROWN AWAY HERE", 4 characters per word (little-endian)
msg:    .word  0x48544f4e, 0x20474e49, 0x45205349, 0x20524556, 0x4f524854, 0x41204e57, 0x20594157, 0x45524548

        .code
start:  addi   r10, ROUNDS
        addi   r6, msg
        xori   r11, FB              ; r11 = screen start
        xori   r1, FB               ; r1 = screen pointer
        xori   r2, FB+8             ; r2 = end of the 8 message pixels

        .loop  ne, r1, r11          ; move the message from the data region onto the screen
        xld    r3, [r6+0]
        xst    r3, [r6+0]
        xst    r3, [r1+0]
        xld    r3, [r1+0]
        addi   r6, 1
        addi   r1, 1
        .again ne, r1, r2
        subi   r1, 8                ; pointers back to the start
        subi   r6, msg+8

        .loop  ne, r1, r11          ; one pass per block; r1 == r11 only on the first
        xld    r3, [r1+0]           ; move x and y into registers (the screen pixels go black)
        xst    r3, [r1+0]
        xld    r4, [r1+1]
        xst    r4, [r1+1]

        .loop  ne, r8, r0           ; one pass per round; r8 == 0 only on the first
        xld    r9, [r8+0]           ; r9 = this round's key
        roli   r3, 24               ; rotr 8
        add    r3, r4
        xor    r3, r9
        roli   r4, 3
        xor    r4, r3
        xld    r9, [r8+0]           ; r9 back to 0
        addi   r8, 1
        .again ne, r8, r10
        subi   r8, ROUNDS           ; r8 back to 0 for the next block

        xst    r3, [r1+0]           ; put the encrypted pair back on the screen, clear the registers
        xld    r3, [r1+0]
        xst    r4, [r1+1]
        xld    r4, [r1+1]
        addi   r1, 2
        .again ne, r1, r2

        xori   r1, FB+8             ; clean up every temporary
        xori   r2, FB+8
        xori   r11, FB
        subi   r10, ROUNDS
        hlt
