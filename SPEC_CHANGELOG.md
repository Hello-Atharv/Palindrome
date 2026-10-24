# Spec Changelog

One line per change to `spec/`, newest last: `YYYY-MM-DD | file | what changed | who`

2026-10-24 | SPEC.md | v0.2: decisions applied (open questions closed), reference pseudocode, worked examples, JS binding, oracle contract, direction log | core
2026-10-24 | vm_api.h | added rvm_get_code; history_bytes now 8 bytes/direction flip in reversible VM (was always 0); branch-on-host-action note | core
2026-10-24 | asm_syntax.md | new file: assembly source syntax | core
2026-10-24 | input_tape.md | window read time defined (value of t before the step); d=-1 caveat | core
2026-10-24 | vm_api.ts | new file: canonical TypeScript API + constants + opcodes for web; SPEC section 8 now points to it (JS binding block removed); vm_api.h stays as C ABI | core
2026-10-24 | SPEC.md | backward() pseudocode: boundary is `q == entry -> HALTED` (was `t == 0`); added strict-check rule 4 (what the logging VM faults on) | core
2026-10-24 | SPEC.md | added section 11 UI requirements (sizes, must/should/could, behaviours, open key-encoding and frame questions) | core
2026-10-24 | SPEC.md | section 11: added 11.2 Views (Debug, Code, Compare), Compare rules, tracker strip, benchmark note; compare mode moved from "could" to "should" via Compare view; subsections renumbered 11.3-11.7 | core
2026-10-24 | SPEC.md, input_tape.md | adopted: key event encoding (pressed<<8 | code), optional FRAME counter at data address 0xFFFF, assembler in TypeScript; section 11.7 now lists conventions (was open questions); section 5 notes 0xFFFF reserved | core
2026-10-24 | SPEC.md | added 11.8 Debugger notes (step over/out definitions, step by frame, run loop, scrubbing chunks, watchpoints, labels and source-map status); no API change | core
2026-10-24 | SPEC.md | 11.1: added "Refresh and limits" (what to read per refresh, default window, scan frequency, measured 48 bytes/step logging history and 256 MiB warning) | core
2026-10-24 | SPEC.md (11.7), input_tape.md | key encoding changed to the viz implementation: value = code | (released ? 0x100 : 0); press is the plain code (ASCII/arrows 0x80-0x83); replaces the earlier (pressed<<8)|code proposal | core
2026-10-24 | SPEC.md (7), vm_api.h behaviour | reversible VM implemented; oracle contract restated: identical state/status after every action for well-formed programs; only the LND assertion is logging-VM-only | core
2026-10-24 | SPEC.md | 11.4/11.8: added reverse watchpoint (run backward until a register or memory word changes; lands on the writing instruction); no API change | core
2026-10-24 | asm_syntax.md, program_format.md, SPEC.md (11.8) | assembler built: asm_syntax.md rewritten to the implemented syntax (expressions, directives, br/lnd forms, rejected cases); source map v1 defined in program_format.md; no ISA change | core
2026-10-24 | asm_syntax.md | added macros: .if/.else/.fi and .loop/.again (expand to br/lnd; same code as hand-written examples); $ labels reserved for generated code; no ISA change | core
2026-10-24 | asm_syntax.md | added macros .with/.endwith, .compute/.use/.uncompute (automatic inverse of straight-line code, checks the use block does not change an input), .plot; no ISA change | core
2026-10-24 | SPEC.md | added section 12 Cost model: quantities (steps, undo_steps, history_bytes, garbage_bits, bits_erased, overhead), tight-floor definition of bits erased, the four compared strategies, reporting rules; built vs planned labelled; no ISA or API change | core
