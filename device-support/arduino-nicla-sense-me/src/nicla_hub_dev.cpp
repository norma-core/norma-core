// The only C++ in src/: hands the Arduino_BHY2 library's hub handle to the C
// modules. BoschSensortec keeps `struct bhy2_dev _bhy2` private and offers no
// accessor. This is the standard-conformant explicit-instantiation idiom: an
// explicit template instantiation may name a private member, and the friend
// function it defines hands the member pointer out. No library patch, no
// #define tricks.
#include "nicla_hub.h"

#include "Arduino_BHY2.h"

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

}  // namespace

extern "C" struct bhy2_dev *nicla_hub_dev(void) {
  return &(sensortec.*privateMember(BhyDevTag()));
}
