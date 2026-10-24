add_executable(placeholder_test placeholder_test.cpp)
target_link_libraries(placeholder_test PRIVATE rvm rvm_warnings)
add_test(NAME placeholder COMMAND placeholder_test)

add_executable(logging_vm_test logging_vm_test.cpp)
target_link_libraries(logging_vm_test PRIVATE rvm rvm_warnings)
add_test(NAME logging_vm COMMAND logging_vm_test)

# Add real tests below, one add_executable + add_test pair each.
