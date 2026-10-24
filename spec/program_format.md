# Program format (.rvm) - DRAFT

All integers are 32-bit unsigned, **little-endian**. File = header, code, data, symbols.

| Words | Field | Notes |
|---|---|---|
| 0 | magic | bytes `R V M 1` (0x314D5652) |
| 1 | version | 1 |
| 2 | entry | initial PC (code word index) |
| 3 | code_len | words |
| 4 | data_len | words, loaded at data address 0 |
| 5 | sym_len | bytes of symbol table |
| 6-7 | reserved | 0 |

Then `code_len` code words (encoding in SPEC.md), `data_len` data words, `sym_len` bytes of symbols.

Symbols (optional, for the debugger/UI): repeated `u32 addr, u8 kind, u8 name_len, name bytes`;
kind 0 = code label, 1 = data label. Entries are not padded.

Loader checks (else `RVM_BAD_PROGRAM`): magic/version, sizes fit the file, `code_len <= 65536`,
`data_len <= 65536`, `entry < code_len`, every opcode defined. The assembler additionally
checks the BR/LND and CALL/PROC/RET pairing rules (SPEC.md).

A source map (`.rvm.map`, JSON, code address -> file:line) may sit beside the image. Its
format is owned by asm and consumed by web; keep it out of the binary.
