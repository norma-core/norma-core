#ifndef X8_CELLULARD_PPP_H
#define X8_CELLULARD_PPP_H

#include <stdbool.h>

#include <glib.h>

#include "config.h"
#include "mm.h"

typedef struct x8_ppp_slot {
    GPid pid;
    char *bearer_path;
    char *tty_path;
    char *ifname;
    bool has_ipv4;
} x8_ppp_slot;

typedef struct x8_ppp {
    x8_ppp_slot slots[X8_MODEM_SLOT_COUNT];
} x8_ppp;

void x8_ppp_init(x8_ppp *ppp);
void x8_ppp_clear(x8_ppp *ppp);
bool x8_ppp_ensure(x8_ppp *ppp,
                   x8_mm *mm,
                   const x8_cellular_config *config,
                   GError **error);
const x8_ppp_slot *x8_ppp_get_slot(const x8_ppp *ppp, x8_modem_slot slot);
void x8_ppp_reset_slot(x8_ppp *ppp, x8_modem_slot slot);

#endif
