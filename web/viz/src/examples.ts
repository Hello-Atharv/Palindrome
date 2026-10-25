/**
 * Example programs written for this UI (the demo programs of the project live in examples/demos/ and examples/asm/).
 * Each is assembly source in the syntax of spec/asm_syntax.md.
 */

/**
 * Adds two numbers typed by the user, prints both and their sum to the console, and files them in memory.
 *
 * It is reversible end to end: reading an input is an xor into a register that holds zero (a copy), `add` has an inverse
 * (`sub`), a store is an xor into memory (so nothing is overwritten), and printing is an xor into the console buffer
 * (SPEC 11.9). Run it backwards and it un-prints, un-adds, un-stores and un-reads.
 */
export const ADD_TWO_NUMBERS = `; Add two numbers.
; Send two numbers with the "Send a number" box BEFORE you step: the machine can only see an input from the moment
; it was sent. It reads them from the input window, prints them and their sum to the console (one per line), and files all three
; in memory (data words 0, 1 and 2).
        .data
first:  .word  0
second: .word  0
sum:    .word  0

        .code
start:  xori  r1, 0x30000        ; r1 = address of the input window
        xld   r2, [r1+2]         ; r2 = first number   (xor into a zero register is a copy)
        xld   r3, [r1+3]         ; r3 = second number
        xst   r2, [r0+0]         ; first  ^= r2        (a store is an xor: nothing is overwritten)
        xst   r3, [r0+1]         ; second ^= r3
        xor   r4, r2             ; r4 = first          (the argument of show)
        call  show               ; print it
        xor   r4, r2             ; r4 = 0 again
        xor   r4, r3
        call  show               ; print the second number
        xor   r4, r3
        add   r2, r3             ; r2 = first + second
        xst   r2, [r0+2]         ; sum    ^= r2
        xor   r4, r2
        call  show               ; print the sum
        xor   r4, r2
        hlt

show:   proc  show_end           ; prints r4 and a new line to the console
        .print r4, signed, r10, r11
        .print 10, r10, r11
show_end: ret
`;

/** The "my program" template: a place to write assembly of your own. */
export const BLANK_PROGRAM = `; My program. Write assembly here, then press Build and load (Ctrl+Enter).
; Registers r1..r13 are free; r14 is the stack pointer and r15 is free too. Data memory starts at word 0.
; Words 0xE000..0xFFFE are the console: print with  .print r1, signed, r10, r11  (r10 and r11 must be zero).
; Reference: spec/asm_syntax.md.
        .code
start:  hlt
`;
