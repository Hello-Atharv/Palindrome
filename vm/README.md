# vm/
Purpose: the two VMs behind `spec/vm_api.h`: the logging VM (oracle) and the reversible VM. Built as the static library `rvm` (C++17).
Owner: **vm**.

`include/` internal headers, `src/` sources. Add new .cpp files to the `rvm` target in the root `CMakeLists.txt`.
