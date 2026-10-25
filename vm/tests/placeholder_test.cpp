// Placeholder: proves the build, link and CTest wiring work.
#include <cstdio>

#include "vm_api.h"

int main() {
    const char* v = rvm_version();
    if (v == nullptr || v[0] == '\0') {
        std::fprintf(stderr, "rvm_version returned nothing\n");
        return 1;
    }
    std::printf("%s\n", v);
    return 0;
}
