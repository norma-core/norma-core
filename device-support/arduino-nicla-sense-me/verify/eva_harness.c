/* Eva needs a concrete hub object: in the firmware nicla_hub_dev() is the C++
   accessor in src/nicla_hub_dev.cpp, which returns the address of the
   Arduino_BHY2 library's device struct. */
#include "nicla_hub.h"

static struct bhy2_dev eva_hub_dev;

struct bhy2_dev *nicla_hub_dev(void) {
  return &eva_hub_dev;
}
