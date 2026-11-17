// The only C++ in src/: the two places where the C modules need the
// Arduino_BHY2 library's C++ side.
//
// 1. The hub handle. BoschSensortec keeps `struct bhy2_dev _bhy2` private and
//    offers no accessor. This is the standard-conformant explicit-instantiation
//    idiom: an explicit template instantiation may name a private member, and
//    the friend function it defines hands the member pointer out. No library
//    patch, no #define tricks.
// 2. The hub's meta events. Arduino_BHY2 is built with
//    BHY2_CFG_DELEGATE_FIFO_PARSE_CB_INFO_MGMT, which makes
//    bhy2_register_fifo_parse_callback() do nothing and routes every meta
//    event to the library's own BoschParser::parseMetaEvent. That handler does
//    one thing with an event: it prints a line to the library's debug stream.
//    So the debug stream is the hook: it is pointed at a stream object that
//    keeps no text and only recognises the one line that reports a sensor's
//    calibration status,
//        "[META EVENT] Accuracy for sensor id <id> changed to <status>"
//    (Arduino_BHY2 1.0.8, BoschParser.cpp). If a later library version words
//    the line differently, no status arrives, register 0x6B stays 0 and no
//    calibration profile is saved: visible, and nothing is saved wrongly.
#include "nicla_hub.h"

#include <string.h>

#include "Arduino_BHY2.h"

#include "bhy2_calibration.h"

namespace {

template <typename Tag, typename Tag::type Member>
struct PrivateMemberAccess {
  friend typename Tag::type privateMember(Tag) { return Member; }
};
struct BhyDevTag {
  typedef struct bhy2_dev BoschSensortec::*type;
  friend type privateMember(BhyDevTag);
};
template struct PrivateMemberAccess<BhyDevTag, &BoschSensortec::_bhy2>;

// Reads a decimal number of at most three digits; -1 when there is none.
int smallNumber(const char *&p) {
  int value = -1;
  for (int digits = 0; digits < 3 && *p >= '0' && *p <= '9'; digits++, p++) {
    value = (value < 0 ? 0 : value * 10) + (*p - '0');
  }
  return value;
}

// The library prints its per-sample debug text without line ends, so a status
// line arrives at the end of an arbitrarily long run of other text. The sink
// therefore keeps no line: it matches the fixed words as they stream past and
// then collects only what follows them up to the end of the line.
class StatusLineSink : public Stream {
public:
  size_t write(uint8_t c) override {
    static const char kId[] = " Accuracy for sensor id ";
    if (collecting_) {
      if (c == '\n') {
        tail_[length_] = '\0';
        parseTail();
        collecting_ = false;
      } else if (c != '\r') {
        if (length_ < sizeof(tail_) - 1) {
          tail_[length_++] = (char)c;
        } else {
          collecting_ = false; // not the line this is looking for
        }
      }
    } else if ((char)c == kId[matched_]) {
      matched_++;
      if (matched_ == sizeof(kId) - 1) {
        collecting_ = true;
        length_ = 0;
        matched_ = 0;
      }
    } else {
      matched_ = ((char)c == kId[0]) ? 1 : 0;
    }
    return 1;
  }
  int available() override { return 0; }
  int read() override { return -1; }
  int peek() override { return -1; }
  void flush() override {}

private:
  // tail_ holds "<id> changed to <status>".
  void parseTail() {
    static const char kStatus[] = " changed to ";
    const char *p = tail_;
    const int id = smallNumber(p);
    if (id < 0 || strncmp(p, kStatus, sizeof(kStatus) - 1) != 0) {
      return;
    }
    p += sizeof(kStatus) - 1;
    const int status = smallNumber(p);
    if (status < 0 || *p != '\0' || id > 255 || status > 255) {
      return;
    }
    bhy2calib_sensor_status((uint8_t)id, (uint8_t)status);
  }

  char tail_[24];
  size_t length_ = 0;
  size_t matched_ = 0;
  bool collecting_ = false;
};

StatusLineSink statusLineSink;

}  // namespace

extern "C" struct bhy2_dev *nicla_hub_dev(void) {
  return &(sensortec.*privateMember(BhyDevTag()));
}

extern "C" void nicla_hub_watch_sensor_status(void) {
  // BHY2.debug() is the public way to set BoschParser's debug stream; it
  // points the library's other debug output at the sink as well, where it is
  // dropped.
  BHY2.debug(statusLineSink);
}
