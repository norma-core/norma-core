#ifndef X8_CELLULARD_CONFIG_H
#define X8_CELLULARD_CONFIG_H

#include <stdbool.h>

typedef enum x8_modem_slot {
    X8_MODEM_SLOT_EXTERNAL = 0,
    X8_MODEM_SLOT_SARA,
    X8_MODEM_SLOT_COUNT,
} x8_modem_slot;

typedef struct x8_modem_identity {
    const char *manufacturer;
    const char *model;
} x8_modem_identity;

typedef struct x8_modem_config {
    x8_modem_slot slot;
    const char *name;
    const char *description;
    x8_modem_identity match;
    bool enabled;
    char *apn;
} x8_modem_config;

typedef struct x8_cellular_config {
    x8_modem_config modems[X8_MODEM_SLOT_COUNT];
} x8_cellular_config;

void x8_cellular_config_init(x8_cellular_config *config);
void x8_cellular_config_clear(x8_cellular_config *config);
void x8_cellular_config_set_apn(x8_cellular_config *config,
                                x8_modem_slot slot,
                                const char *apn);
bool x8_cellular_config_any_enabled(const x8_cellular_config *config);
const x8_modem_config *
x8_cellular_config_get_modem(const x8_cellular_config *config,
                             x8_modem_slot slot);
const char *x8_modem_slot_name(x8_modem_slot slot);

#endif
