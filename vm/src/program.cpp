#include "rvm/program.h"

#include "rvm/isa.h"

namespace rev {

namespace {

constexpr uint32_t kMagic = 0x314D5652;  // "RVM1" little-endian
constexpr uint32_t kVersion = 1;
constexpr size_t kHeaderBytes = 32;

uint32_t rd32(const uint8_t* p) {
    return static_cast<uint32_t>(p[0]) | (static_cast<uint32_t>(p[1]) << 8) |
           (static_cast<uint32_t>(p[2]) << 16) | (static_cast<uint32_t>(p[3]) << 24);
}

void wr32(std::vector<uint8_t>& v, uint32_t x) {
    for (int i = 0; i < 4; ++i) v.push_back(static_cast<uint8_t>(x >> (8 * i)));
}

}  // namespace

bool parse_program(const uint8_t* b, size_t len, Program& out, std::string& err) {
    if (b == nullptr || len < kHeaderBytes) {
        err = "image shorter than header";
        return false;
    }
    if (rd32(b) != kMagic) {
        err = "bad magic";
        return false;
    }
    if (rd32(b + 4) != kVersion) {
        err = "unsupported version";
        return false;
    }
    const uint32_t entry = rd32(b + 8);
    const uint32_t code_len = rd32(b + 12);
    const uint32_t data_len = rd32(b + 16);
    const uint32_t sym_len = rd32(b + 20);
    if (code_len == 0 || code_len > kMaxCodeWords || data_len > kMaxDataWords) {
        err = "code/data length out of range";
        return false;
    }
    if (entry >= code_len) {
        err = "entry outside code";
        return false;
    }
    const uint64_t expect = kHeaderBytes + 4ull * code_len + 4ull * data_len + sym_len;
    if (expect != len) {
        err = "image size does not match header";
        return false;
    }
    Program p;
    p.entry = entry;
    p.code.resize(code_len);
    p.data.resize(data_len);
    const uint8_t* q = b + kHeaderBytes;
    for (uint32_t i = 0; i < code_len; ++i, q += 4) {
        p.code[i] = rd32(q);
        if (!valid_opcode(p.code[i])) {
            err = "undefined opcode at code address " + std::to_string(i);
            return false;
        }
    }
    for (uint32_t i = 0; i < data_len; ++i, q += 4) p.data[i] = rd32(q);
    out = std::move(p);
    return true;
}

std::vector<uint8_t> serialize_program(const Program& p, const std::vector<uint8_t>& symbols) {
    std::vector<uint8_t> v;
    wr32(v, kMagic);
    wr32(v, kVersion);
    wr32(v, p.entry);
    wr32(v, static_cast<uint32_t>(p.code.size()));
    wr32(v, static_cast<uint32_t>(p.data.size()));
    wr32(v, static_cast<uint32_t>(symbols.size()));
    wr32(v, 0);
    wr32(v, 0);
    for (uint32_t w : p.code) wr32(v, w);
    for (uint32_t w : p.data) wr32(v, w);
    v.insert(v.end(), symbols.begin(), symbols.end());
    return v;
}

}  // namespace rev
