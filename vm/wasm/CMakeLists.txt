# WebAssembly build of the VMs (needs Emscripten; see the root README / vm/README.md).
# Output: web/wasm/lib/rvm_core.js, a single file with the wasm embedded, loadable by Vite, Node and workers.
add_executable(rvm_core exports.cpp)
target_link_libraries(rvm_core PRIVATE rvm)

set(RVM_EXPORTS
    _rvm_version _rvm_create _rvm_destroy _rvm_load_program _rvm_set_input_tape _rvm_push_input
    _rvm_step_forward _rvm_step_back _rvm_get_registers _rvm_get_memory _rvm_get_code
    _rvm_get_direction _rvm_set_direction _rvm_last_error
    _rvm_wasm_instruction_count _rvm_wasm_run_to _rvm_wasm_history_bytes
    _malloc _free)
string(REPLACE ";" "," RVM_EXPORTS_CSV "${RVM_EXPORTS}")

target_link_options(rvm_core PRIVATE
    -O2
    -sMODULARIZE=1
    -sEXPORT_ES6=1
    -sEXPORT_NAME=createRvmCore
    -sENVIRONMENT=web,worker,node
    -sSINGLE_FILE=1
    -sALLOW_MEMORY_GROWTH=1
    -sFILESYSTEM=0
    -sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAPU32,UTF8ToString
    "-sEXPORTED_FUNCTIONS=${RVM_EXPORTS_CSV}")

set_target_properties(rvm_core PROPERTIES
    SUFFIX ".js"
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_SOURCE_DIR}/web/wasm/lib")
