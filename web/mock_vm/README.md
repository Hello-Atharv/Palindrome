# web/mock_vm/
Purpose: a TypeScript implementation of `RVM` (`spec/vm_api.ts`) so UI work is not blocked. Simplest version:
an interpreter of the reference semantics in SPEC.md section 6 that keeps a history array (it is a logging VM,
`kind: 'logging'`). Must pass the same behaviour the real VMs will: `stepBack` exactly undoes `stepForward`.
Owner: **viz**.
