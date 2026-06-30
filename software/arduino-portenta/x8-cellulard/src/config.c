#define _POSIX_C_SOURCE 200809L

#include "config.h"

#include <stddef.h>

#include <glib.h>

static bool slot_is_valid(x8_modem_slot slot)
{
    return slot == X8_MODEM_SLOT_EXTERNAL || slot == X8_MODEM_SLOT_SARA;
}

void x8_cellular_config_init(x8_cellular_config *config)
{
    if (config == NULL) {
        return;
    }

    *config = (x8_cellular_config){
        .modems = {
            [X8_MODEM_SLOT_EXTERNAL] = {
                .slot = X8_MODEM_SLOT_EXTERNAL,
                .name = "external",
                .description = "Max Carrier external LTE/GNSS modem",
                .match = {
                    .manufacturer = "Quectel",
                    .model = "EC200A",
                },
                .enabled = false,
                .apn = NULL,
            },
            [X8_MODEM_SLOT_SARA] = {
                .slot = X8_MODEM_SLOT_SARA,
                .name = "sara",
                .description = "Portenta X8 onboard SARA-R4 modem",
                .match = {
                    .manufacturer = "u-blox",
                    .model = "SARA-R412M-02B",
                },
                .enabled = false,
                .apn = NULL,
            },
        },
    };
}

void x8_cellular_config_clear(x8_cellular_config *config)
{
    if (config == NULL) {
        return;
    }

    for (x8_modem_slot slot = X8_MODEM_SLOT_EXTERNAL;
         slot < X8_MODEM_SLOT_COUNT;
         slot++) {
        g_clear_pointer(&config->modems[slot].apn, g_free);
        config->modems[slot].enabled = false;
    }
}

void x8_cellular_config_set_apn(x8_cellular_config *config,
                                x8_modem_slot slot,
                                const char *apn)
{
    if (config == NULL || !slot_is_valid(slot)) {
        return;
    }

    g_clear_pointer(&config->modems[slot].apn, g_free);
    if (apn != NULL && apn[0] != '\0') {
        config->modems[slot].apn = g_strdup(apn);
    }
    config->modems[slot].enabled = config->modems[slot].apn != NULL;
}

bool x8_cellular_config_any_enabled(const x8_cellular_config *config)
{
    if (config == NULL) {
        return false;
    }

    for (x8_modem_slot slot = X8_MODEM_SLOT_EXTERNAL;
         slot < X8_MODEM_SLOT_COUNT;
         slot++) {
        if (config->modems[slot].enabled) {
            return true;
        }
    }

    return false;
}

const x8_modem_config *
x8_cellular_config_get_modem(const x8_cellular_config *config,
                             x8_modem_slot slot)
{
    if (config == NULL || !slot_is_valid(slot)) {
        return NULL;
    }

    return &config->modems[slot];
}

const char *x8_modem_slot_name(x8_modem_slot slot)
{
    switch (slot) {
    case X8_MODEM_SLOT_EXTERNAL:
        return "external";
    case X8_MODEM_SLOT_SARA:
        return "sara";
    case X8_MODEM_SLOT_COUNT:
        break;
    }

    return "unknown";
}
