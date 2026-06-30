#define _POSIX_C_SOURCE 200809L

#include "gpio_power.h"

#include <errno.h>
#include <stdio.h>

#include <glib.h>
#include <gpiod.h>

#define X8_GPIO_POWER_CHIP_PATH "/dev/gpiochip5"
#define X8_GPIO_POWER_CONSUMER "x8-cellulard"
#define X8_GPIO_POWER_MAX_ATTEMPTS 5
#define X8_GPIO_POWER_RETRY_USEC G_USEC_PER_SEC

typedef struct x8_gpio_power_line {
    const char *name;
    unsigned int offset;
    enum gpiod_line_value enabled_value;
    enum gpiod_line_value disabled_value;
} x8_gpio_power_line;

typedef struct x8_gpio_power_modem_config {
    x8_modem_slot slot;
    const char *name;
    const x8_gpio_power_line *lines;
    size_t num_lines;
} x8_gpio_power_modem_config;

static const x8_gpio_power_line x8_gpio_power_external_lines[] = {
    {
        .name = "external-lte-pwr",
        .offset = 29,
        .enabled_value = GPIOD_LINE_VALUE_ACTIVE,
        .disabled_value = GPIOD_LINE_VALUE_INACTIVE,
    },
};

static const x8_gpio_power_line x8_gpio_power_sara_lines[] = {
    {
        .name = "sara-pwr",
        .offset = 4,
        .enabled_value = GPIOD_LINE_VALUE_ACTIVE,
        .disabled_value = GPIOD_LINE_VALUE_INACTIVE,
    },
    {
        .name = "sara-rst",
        .offset = 2,
        .enabled_value = GPIOD_LINE_VALUE_INACTIVE,
        .disabled_value = GPIOD_LINE_VALUE_ACTIVE,
    },
};

static const x8_gpio_power_modem_config
    x8_gpio_power_modems[X8_MODEM_SLOT_COUNT] = {
        [X8_MODEM_SLOT_EXTERNAL] = {
            .slot = X8_MODEM_SLOT_EXTERNAL,
            .name = "external",
            .lines = x8_gpio_power_external_lines,
            .num_lines = G_N_ELEMENTS(x8_gpio_power_external_lines),
        },
        [X8_MODEM_SLOT_SARA] = {
            .slot = X8_MODEM_SLOT_SARA,
            .name = "sara",
            .lines = x8_gpio_power_sara_lines,
            .num_lines = G_N_ELEMENTS(x8_gpio_power_sara_lines),
        },
    };

static GQuark x8_gpio_power_error_quark(void)
{
    return g_quark_from_static_string("x8-gpio-power-error");
}

static const char *line_value_name(enum gpiod_line_value value)
{
    switch (value) {
    case GPIOD_LINE_VALUE_INACTIVE:
        return "0";
    case GPIOD_LINE_VALUE_ACTIVE:
        return "1";
    case GPIOD_LINE_VALUE_ERROR:
        break;
    }

    return "error";
}

static void set_errno_error(GError **error, const char *operation)
{
    g_set_error(error,
                x8_gpio_power_error_quark(),
                errno,
                "%s: %s",
                operation,
                g_strerror(errno));
}

static void x8_gpio_power_modem_clear(x8_gpio_power_modem *modem)
{
    if (modem == NULL) {
        return;
    }

    if (modem->request != NULL) {
        gpiod_line_request_release(modem->request);
        modem->request = NULL;
    }

    if (modem->chip != NULL) {
        gpiod_chip_close(modem->chip);
        modem->chip = NULL;
    }

    modem->have_last_values = false;
    modem->logged_initial_values = false;
}

static void desired_values_from_config(
    const x8_gpio_power_modem_config *modem,
    bool enabled,
    enum gpiod_line_value values[])
{
    for (size_t i = 0; i < modem->num_lines; i++) {
        values[i] = enabled ? modem->lines[i].enabled_value
                            : modem->lines[i].disabled_value;
    }
}

static void log_gpio_values(const x8_gpio_power_modem_config *modem,
                            const char *prefix,
                            const enum gpiod_line_value values[])
{
    GString *message = g_string_new(NULL);

    g_string_append_printf(message, "gpio power: %s %s:", modem->name, prefix);
    for (size_t i = 0; i < modem->num_lines; i++) {
        g_string_append_printf(message,
                               "%s %s:%u %s=%s",
                               i == 0 ? "" : ",",
                               X8_GPIO_POWER_CHIP_PATH,
                               modem->lines[i].offset,
                               modem->lines[i].name,
                               line_value_name(values[i]));
    }

    g_message("%s", message->str);
    g_string_free(message, TRUE);
}

static bool values_differ(const x8_gpio_power_modem_config *modem,
                          const enum gpiod_line_value left[],
                          const enum gpiod_line_value right[])
{
    for (size_t i = 0; i < modem->num_lines; i++) {
        if (left[i] != right[i]) {
            return true;
        }
    }

    return false;
}

static void remember_gpio_values(x8_gpio_power_modem *state,
                                 const x8_gpio_power_modem_config *modem,
                                 const enum gpiod_line_value values[])
{
    for (size_t i = 0; i < modem->num_lines; i++) {
        state->last_values[i] = values[i];
    }
    state->have_last_values = true;
}

static void log_planned_changes(const x8_gpio_power_modem_config *modem,
                                const enum gpiod_line_value current[],
                                const enum gpiod_line_value desired[])
{
    for (size_t i = 0; i < modem->num_lines; i++) {
        if (current[i] == desired[i]) {
            continue;
        }

        g_message("gpio power: changing %s %s:%u %s %s -> %s",
                  modem->name,
                  X8_GPIO_POWER_CHIP_PATH,
                  modem->lines[i].offset,
                  modem->lines[i].name,
                  line_value_name(current[i]),
                  line_value_name(desired[i]));
    }
}

static void log_values_if_changed(x8_gpio_power_modem *state,
                                  const x8_gpio_power_modem_config *modem,
                                  const enum gpiod_line_value values[])
{
    if (state->have_last_values &&
        !values_differ(modem, state->last_values, values)) {
        return;
    }

    log_gpio_values(modem, "current", values);
    remember_gpio_values(state, modem, values);
}

static void fill_offsets(const x8_gpio_power_modem_config *modem,
                         unsigned int offsets[])
{
    for (size_t i = 0; i < modem->num_lines; i++) {
        offsets[i] = modem->lines[i].offset;
    }
}

static bool read_gpio_values(x8_gpio_power_modem *state,
                             const x8_gpio_power_modem_config *modem,
                             enum gpiod_line_value values[],
                             GError **error)
{
    unsigned int offsets[X8_GPIO_POWER_MAX_LINES_PER_MODEM];

    fill_offsets(modem, offsets);

    if (gpiod_line_request_get_values_subset(state->request,
                                             modem->num_lines,
                                             offsets,
                                             values) != 0) {
        set_errno_error(error, "read GPIO power output values");
        return false;
    }

    return true;
}

static bool request_gpio_lines(x8_gpio_power_modem *state,
                               const x8_gpio_power_modem_config *modem,
                               GError **error)
{
    struct gpiod_line_settings *settings = NULL;
    struct gpiod_line_config *line_config = NULL;
    struct gpiod_request_config *request_config = NULL;
    unsigned int offsets[X8_GPIO_POWER_MAX_LINES_PER_MODEM];
    bool ok = false;

    state->chip = gpiod_chip_open(X8_GPIO_POWER_CHIP_PATH);
    if (state->chip == NULL) {
        set_errno_error(error, "open gpio chip " X8_GPIO_POWER_CHIP_PATH);
        return false;
    }

    settings = gpiod_line_settings_new();
    line_config = gpiod_line_config_new();
    request_config = gpiod_request_config_new();
    if (settings == NULL || line_config == NULL || request_config == NULL) {
        g_set_error_literal(error,
                            x8_gpio_power_error_quark(),
                            ENOMEM,
                            "allocate GPIO request objects: out of memory");
        goto out;
    }

    if (gpiod_line_settings_set_direction(settings,
                                          GPIOD_LINE_DIRECTION_AS_IS) != 0) {
        set_errno_error(error, "configure GPIO lines as-is");
        goto out;
    }

    fill_offsets(modem, offsets);
    if (gpiod_line_config_add_line_settings(line_config,
                                            offsets,
                                            modem->num_lines,
                                            settings) != 0) {
        set_errno_error(error, "configure GPIO line offsets");
        goto out;
    }

    gpiod_request_config_set_consumer(request_config,
                                      X8_GPIO_POWER_CONSUMER);
    state->request = gpiod_chip_request_lines(state->chip,
                                              request_config,
                                              line_config);
    if (state->request == NULL) {
        set_errno_error(error, "request GPIO power lines");
        goto out;
    }

    ok = true;

out:
    if (request_config != NULL) {
        gpiod_request_config_free(request_config);
    }
    if (line_config != NULL) {
        gpiod_line_config_free(line_config);
    }
    if (settings != NULL) {
        gpiod_line_settings_free(settings);
    }

    if (!ok) {
        x8_gpio_power_modem_clear(state);
    }

    return ok;
}

static bool apply_gpio_values(x8_gpio_power_modem *state,
                              const x8_gpio_power_modem_config *modem,
                              const enum gpiod_line_value values[],
                              GError **error)
{
    struct gpiod_line_settings *settings = NULL;
    struct gpiod_line_config *line_config = NULL;
    unsigned int offsets[X8_GPIO_POWER_MAX_LINES_PER_MODEM];
    bool ok = false;

    settings = gpiod_line_settings_new();
    line_config = gpiod_line_config_new();
    if (settings == NULL || line_config == NULL) {
        g_set_error_literal(error,
                            x8_gpio_power_error_quark(),
                            ENOMEM,
                            "allocate GPIO output config objects: out of memory");
        goto out;
    }

    if (gpiod_line_settings_set_direction(settings,
                                          GPIOD_LINE_DIRECTION_OUTPUT) != 0) {
        set_errno_error(error, "configure GPIO lines as output");
        goto out;
    }

    fill_offsets(modem, offsets);
    if (gpiod_line_config_add_line_settings(line_config,
                                            offsets,
                                            modem->num_lines,
                                            settings) != 0) {
        set_errno_error(error, "configure GPIO output line offsets");
        goto out;
    }

    if (gpiod_line_config_set_output_values(line_config,
                                            values,
                                            modem->num_lines) != 0) {
        set_errno_error(error, "configure GPIO output values");
        goto out;
    }

    if (gpiod_line_request_reconfigure_lines(state->request, line_config) != 0) {
        set_errno_error(error, "apply GPIO output values");
        goto out;
    }

    ok = true;

out:
    if (line_config != NULL) {
        gpiod_line_config_free(line_config);
    }
    if (settings != NULL) {
        gpiod_line_settings_free(settings);
    }

    return ok;
}

static bool ensure_modem_gpio_power(x8_gpio_power_modem *state,
                                    const x8_gpio_power_modem_config *modem,
                                    bool enabled,
                                    GError **error)
{
    enum gpiod_line_value current[X8_GPIO_POWER_MAX_LINES_PER_MODEM];
    enum gpiod_line_value desired[X8_GPIO_POWER_MAX_LINES_PER_MODEM];
    bool changing = false;

    desired_values_from_config(modem, enabled, desired);

    if (state->request == NULL && !request_gpio_lines(state, modem, error)) {
        return false;
    }

    if (!read_gpio_values(state, modem, current, error)) {
        x8_gpio_power_modem_clear(state);
        return false;
    }

    changing = values_differ(modem, current, desired);
    if (!state->logged_initial_values) {
        log_gpio_values(modem, "before", current);
        state->logged_initial_values = true;
    } else {
        log_values_if_changed(state, modem, current);
    }

    if (changing) {
        log_planned_changes(modem, current, desired);
    }

    if (!apply_gpio_values(state, modem, desired, error)) {
        x8_gpio_power_modem_clear(state);
        return false;
    }

    if (!read_gpio_values(state, modem, current, error)) {
        x8_gpio_power_modem_clear(state);
        return false;
    }

    if (changing) {
        log_gpio_values(modem, "after", current);
    }

    if (values_differ(modem, current, desired)) {
        g_set_error(error,
                    x8_gpio_power_error_quark(),
                    EIO,
                    "GPIO power values did not settle for %s",
                    modem->name);
        x8_gpio_power_modem_clear(state);
        return false;
    }

    remember_gpio_values(state, modem, current);
    return true;
}

void x8_gpio_power_init(x8_gpio_power *power)
{
    if (power == NULL) {
        return;
    }

    *power = (x8_gpio_power){0};
}

void x8_gpio_power_clear(x8_gpio_power *power)
{
    if (power == NULL) {
        return;
    }

    for (x8_modem_slot slot = X8_MODEM_SLOT_EXTERNAL;
         slot < X8_MODEM_SLOT_COUNT;
         slot++) {
        x8_gpio_power_modem_clear(&power->modems[slot]);
    }
}

bool x8_gpio_power_ensure(x8_gpio_power *power,
                          const x8_cellular_config *config)
{
    for (unsigned int attempt = 1; attempt <= X8_GPIO_POWER_MAX_ATTEMPTS;
         attempt++) {
        bool any_enabled_modem = false;
        bool any_enabled_modem_powered = false;

        for (x8_modem_slot slot = X8_MODEM_SLOT_EXTERNAL;
             slot < X8_MODEM_SLOT_COUNT;
             slot++) {
            const x8_gpio_power_modem_config *gpio_modem =
                &x8_gpio_power_modems[slot];
            const x8_modem_config *modem =
                x8_cellular_config_get_modem(config, slot);
            bool enabled = modem != NULL && modem->enabled;
            g_autoptr(GError) error = NULL;

            if (enabled) {
                any_enabled_modem = true;
            }

            if (!ensure_modem_gpio_power(&power->modems[slot],
                                         gpio_modem,
                                         enabled,
                                         &error)) {
                g_warning("gpio power: %s attempt %u/%u failed: %s",
                          gpio_modem->name,
                          attempt,
                          X8_GPIO_POWER_MAX_ATTEMPTS,
                          error != NULL ? error->message : "unknown error");
                continue;
            }

            if (enabled) {
                any_enabled_modem_powered = true;
            }
        }

        if (any_enabled_modem_powered) {
            return true;
        }

        if (!any_enabled_modem) {
            g_warning("gpio power: no modem enabled by APN parameters; need at least one working modem");
        }

        if (attempt < X8_GPIO_POWER_MAX_ATTEMPTS) {
            g_usleep(X8_GPIO_POWER_RETRY_USEC);
        }
    }

    g_warning("gpio power: no enabled modem GPIO power path working after %u attempts",
              X8_GPIO_POWER_MAX_ATTEMPTS);
    return false;
}
