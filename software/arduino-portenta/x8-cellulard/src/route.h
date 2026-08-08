#ifndef X8_CELLULARD_ROUTE_H
#define X8_CELLULARD_ROUTE_H

#include <stdbool.h>

#include <glib.h>

#include "config.h"
#include "ppp.h"

bool x8_route_ensure(const x8_cellular_config *config,
                     const x8_ppp *ppp,
                     GError **error);

#endif
