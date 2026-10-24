// .rvm program image: parse and serialize (spec/program_format.md).
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace rev {

struct Program {
    uint32_t entry = 0;
    std::vector<uint32_t> code;
    std::vector<uint32_t> data;  // loaded at data address 0
};

// Returns false and sets err if the image is malformed.
bool parse_program(const uint8_t* bytes, size_t len, Program& out, std::string& err);

// Symbols are an opaque, already-encoded blob (the VM ignores them).
std::vector<uint8_t> serialize_program(const Program& p, const std::vector<uint8_t>& symbols = {});

}  // namespace rev
