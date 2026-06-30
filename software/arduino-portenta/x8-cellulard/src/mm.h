#ifndef X8_CELLULARD_MM_H
#define X8_CELLULARD_MM_H

#include <stdbool.h>

#include <glib.h>

#include "config.h"

typedef struct _MMManager MMManager;
typedef struct _MMBearer MMBearer;

typedef enum x8_mm_ip_method {
    X8_MM_IP_METHOD_UNKNOWN = 0,
    X8_MM_IP_METHOD_PPP,
    X8_MM_IP_METHOD_STATIC,
    X8_MM_IP_METHOD_DHCP,
} x8_mm_ip_method;

typedef struct x8_mm_bearer_status {
    bool connected;
    x8_modem_slot slot;
    char *bearer_path;
    char *interface;
    char *apn;
    x8_mm_ip_method ipv4_method;
} x8_mm_bearer_status;

typedef struct x8_mm_slot_state {
    MMBearer *bearer;
    x8_mm_bearer_status bearer_status;
} x8_mm_slot_state;

typedef struct x8_mm {
    MMManager *manager;
    bool logged_manager;
    x8_mm_slot_state slots[X8_MODEM_SLOT_COUNT];
} x8_mm;

void x8_mm_init(x8_mm *mm);
void x8_mm_clear(x8_mm *mm);
bool x8_mm_ensure_modems(x8_mm *mm,
                         const x8_cellular_config *config,
                         GError **error);
const x8_mm_bearer_status *x8_mm_get_bearer_status(const x8_mm *mm,
                                                    x8_modem_slot slot);
const char *x8_mm_ip_method_name(x8_mm_ip_method method);
bool x8_mm_disconnect_bearer(x8_mm *mm,
                             x8_modem_slot slot,
                             GError **error);
bool x8_mm_disconnect_and_disable_modem(x8_mm *mm,
                                        const x8_cellular_config *config,
                                        x8_modem_slot slot,
                                        GError **error);

#endif
