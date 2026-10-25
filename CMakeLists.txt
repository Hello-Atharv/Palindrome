cmake_minimum_required(VERSION 3.21)
project(revvm LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Warnings, per compiler. Link rvm_warnings (PRIVATE) from any target to opt in.
add_library(rvm_warnings INTERFACE)
if(MSVC)
    target_compile_options(rvm_warnings INTERFACE /W4 /permissive-)
elseif(CMAKE_CXX_COMPILER_ID MATCHES "Clang|GNU")
    target_compile_options(rvm_warnings INTERFACE -Wall -Wextra -Wpedantic)
endif()

# The VM library. Add new sources to this list (owner: vm).
add_library(rvm STATIC
    vm/src/api.cpp
    vm/src/logging_vm.cpp
    vm/src/machine.cpp
    vm/src/program.cpp
    vm/src/reversible_vm.cpp
)
target_include_directories(rvm PUBLIC spec vm/include)
target_include_directories(rvm PRIVATE vm/src)
target_link_libraries(rvm PRIVATE rvm_warnings)

if(EMSCRIPTEN)
    # WebAssembly build: only the library and the JS-facing module (vm/wasm).
    add_subdirectory(vm/wasm)
else()
    # Command line runner for .rvm programs (used by the assembler's integration tests).
    add_executable(rvm_run vm/tools/rvm_run.cpp)
    target_link_libraries(rvm_run PRIVATE rvm rvm_warnings)

    enable_testing()
    add_subdirectory(vm/tests)
    add_subdirectory(bench)
endif()
