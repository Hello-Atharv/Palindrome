/* vm_api.h - C API shared by the logging VM (oracle) and the reversible VM.
 * DRAFT. Any change here is a spec change: add a line to SPEC_CHANGELOG.md.
 *
 * Terms: "time" t = instruction_count. step_forward: t -> t+1. step_back: t -> t-1
 * (exact inverse). "direction" is which way the PROGRAM runs (+1 normal, -1 program
 * executed as its own inverse); it is host-set and independent of time.
 * Addresses in get_memory are data-space WORD addresses (see SPEC.md memory map).
 */
#ifndef RVM_API_H
#define RVM_API_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct rvm rvm_t;

typedef enum {
    RVM_KIND_LOGGING = 0,    /* oracle: records deltas */
    RVM_KIND_REVERSIBLE = 1  /* no history */
} rvm_kind;

typedef enum {
    RVM_OK = 0,
    RVM_HALTED = 1,       /* PC is at HLT (forward) */
    RVM_AT_START = 2,     /* t == 0, cannot step back */
    RVM_FAULT = -1,       /* illegal instruction/operand/address; state unchanged */
    RVM_BAD_ARG = -2,
    RVM_BAD_PROGRAM = -3
} rvm_status;

const char* rvm_version(void);

rvm_t* rvm_create(rvm_kind kind);
void rvm_destroy(rvm_t* vm);

/* Load a program image (spec/program_format.md) and reset to t = 0. */
rvm_status rvm_load_program(rvm_t* vm, const uint8_t* image, size_t len);

/* Input tape (spec/input_tape.md). set replaces it; push appends an event stamped
 * with the current t (events later than t are discarded first). */
rvm_status rvm_set_input_tape(rvm_t* vm, const uint8_t* tape, size_t len);
rvm_status rvm_push_input(rvm_t* vm, uint32_t value);

rvm_status rvm_step_forward(rvm_t* vm);
rvm_status rvm_step_back(rvm_t* vm);
/* Step forward or back until instruction_count == n. Stops early on halt/fault. */
rvm_status rvm_run_to(rvm_t* vm, uint64_t n);

rvm_status rvm_get_registers(const rvm_t* vm, uint32_t out_regs[16], uint32_t* out_pc);
/* Copies nwords words starting at word address addr (data space) into out. */
rvm_status rvm_get_memory(const rvm_t* vm, uint32_t addr, uint32_t nwords, uint32_t* out);

int rvm_get_direction(const rvm_t* vm);            /* +1 or -1 */
rvm_status rvm_set_direction(rvm_t* vm, int dir);  /* +1 or -1 */

uint64_t rvm_instruction_count(const rvm_t* vm);

/* Bytes of memory used to hold history. Always 0 for the reversible VM. */
size_t rvm_history_bytes(const rvm_t* vm);

const char* rvm_last_error(const rvm_t* vm);

#ifdef __cplusplus
}
#endif

#endif /* RVM_API_H */
