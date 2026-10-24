# Spec Changelog

One line per change to `spec/`, newest last: `YYYY-MM-DD | file | what changed | who`

2026-10-24 | SPEC.md | v0.2: decisions applied (open questions closed), reference pseudocode, worked examples, JS binding, oracle contract, direction log | core
2026-10-24 | vm_api.h | added rvm_get_code; history_bytes now 8 bytes/direction flip in reversible VM (was always 0); branch-on-host-action note | core
2026-10-24 | asm_syntax.md | new file: assembly source syntax | core
2026-10-24 | input_tape.md | window read time defined (value of t before the step); d=-1 caveat | core
2026-10-24 | vm_api.ts | new file: canonical TypeScript API + constants + opcodes for web; SPEC section 8 now points to it (JS binding block removed); vm_api.h stays as C ABI | core
