// Host-side timeline data shared by both VMs: the input tape and the direction log.
// See spec/input_tape.md and spec/SPEC.md section 7.
#pragma once

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace rev {

constexpr uint32_t kMaxWindowEvents = 0x10000 - 2;

class InputTape {
public:
    struct Event {
        uint64_t t;
        uint32_t value;
    };

    // Tape file: "RVMT", count, then count pairs (t, value), all little-endian u32.
    bool parse(const uint8_t* b, size_t len, std::string& err) {
        if (b == nullptr || len < 8 || rd32(b) != 0x544D5652u) {
            err = "bad tape header";
            return false;
        }
        const uint32_t count = rd32(b + 4);
        if (len != 8 + 8ull * count) {
            err = "tape size does not match count";
            return false;
        }
        std::vector<Event> ev;
        ev.reserve(count);
        for (uint32_t i = 0; i < count; ++i) {
            const uint8_t* q = b + 8 + 8ull * i;
            Event e{rd32(q), rd32(q + 4)};
            if (!ev.empty() && e.t < ev.back().t) {
                err = "tape timestamps decrease";
                return false;
            }
            ev.push_back(e);
        }
        events_ = std::move(ev);
        return true;
    }

    // Host action at time t: drop events later than t, then append.
    void push(uint64_t t, uint32_t value) {
        drop_after(t);
        events_.push_back({t, value});
    }
    void drop_after(uint64_t t) {
        while (!events_.empty() && events_.back().t > t) events_.pop_back();
    }

    // Number of events visible at time t (t_k <= t), capped to the window size.
    uint32_t count_at(uint64_t t) const {
        auto it = std::upper_bound(events_.begin(), events_.end(), t,
                                   [](uint64_t x, const Event& e) { return x < e.t; });
        const size_t n = static_cast<size_t>(it - events_.begin());
        return static_cast<uint32_t>(std::min<size_t>(n, kMaxWindowEvents));
    }
    uint32_t value(uint32_t k) const { return events_[k].value; }

private:
    static uint32_t rd32(const uint8_t* p) {
        return static_cast<uint32_t>(p[0]) | (static_cast<uint32_t>(p[1]) << 8) |
               (static_cast<uint32_t>(p[2]) << 16) | (static_cast<uint32_t>(p[3]) << 24);
    }
    std::vector<Event> events_;
};

// Program direction as a function of time: dir_at(t) is the direction of the step t -> t+1.
// Host actions at time t drop later entries (new branch).
class DirLog {
public:
    int at(uint64_t t) const {
        int d = 1;
        for (const Entry& e : entries_) {
            if (e.t > t) break;
            d = e.dir;
        }
        return d;
    }
    void set(uint64_t t, int dir) {
        drop_after(t);
        if (!entries_.empty() && entries_.back().t == t) entries_.pop_back();
        if (at(t) != dir) entries_.push_back({t, dir});
    }
    void drop_after(uint64_t t) {
        while (!entries_.empty() && entries_.back().t > t) entries_.pop_back();
    }
    void clear() { entries_.clear(); }
    size_t bytes() const { return entries_.size() * 8; }  // (t, dir) pairs counted as 8 bytes each

private:
    struct Entry {
        uint64_t t;
        int dir;
    };
    std::vector<Entry> entries_;
};

}  // namespace rev
