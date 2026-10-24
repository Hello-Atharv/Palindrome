/**
 * Example programs written for this UI (the demo programs of the project live in programs/ and asm/examples/).
 * Each is assembly source in the syntax of spec/asm_syntax.md.
 */

/**
 * Adds two numbers typed by the user and files the answer in memory.
 *
 * It is reversible end to end: reading an input is an xor into a register that holds zero (a copy), `add` has an inverse
 * (`sub`), and a store is an xor into memory (so nothing is overwritten). Run it backwards and it un-adds, un-stores and
 * un-reads, leaving every register and memory word as it was at the start.
 */
export const ADD_TWO_NUMBERS = `; Add two numbers.
; Send two numbers with the "Send a number" box BEFORE you step: the machine can only see an input from the moment
; it was sent. It reads them from the input window (word 2 is the first, word 3 the second), adds them, and files
; the numbers and their sum in memory, where the Values panel shows them.
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
        add   r2, r3             ; r2 = first + second
        xst   r2, [r0+2]         ; sum    ^= r2
        hlt
`;
