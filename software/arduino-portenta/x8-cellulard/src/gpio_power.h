#ifndef X8_CELLULARD_GPIO_POWER_H
#define X8_CELLULARD_GPIO_POWER_H

#include <stdbool.h>

#include <gpiod.h>

#include "config.h"

#define X8_GPIO_POWER_MAX_LINES_PER_MODEM 2

typedef struct x8_gpio_power_modem {
    struct gpiod_chip *chip;
    char *chip_path;
    struct gpiod_line_request *request;
    bool have_last_values;
    bool logged_initial_values;
    enum gpiod_line_value last_values[X8_GPIO_POWER_MAX_LINES_PER_MODEM];
} x8_gpio_power_modem;

typedef struct x8_gpio_power {
    x8_gpio_power_modem modems[X8_MODEM_SLOT_COUNT];
} x8_gpio_power;

void x8_gpio_power_init(x8_gpio_power *power);
void x8_gpio_power_clear(x8_gpio_power *power);
bool x8_gpio_power_ensure(x8_gpio_power *power,
                          const x8_cellular_config *config);

#endif
