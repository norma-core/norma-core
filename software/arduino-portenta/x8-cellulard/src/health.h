#ifndef X8_CELLULARD_HEALTH_H
#define X8_CELLULARD_HEALTH_H

#include <stdbool.h>

#include <glib.h>

#include "config.h"
#include "mm.h"
#include "ppp.h"

bool x8_health_ensure(const x8_cellular_config *config,
                      x8_mm *mm,
                      x8_ppp *ppp,
                      GError **error);

#endif
