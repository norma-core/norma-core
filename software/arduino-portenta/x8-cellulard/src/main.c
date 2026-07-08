#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <signal.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>

#include <gio/gio.h>
#include <glib.h>
#include <gpiod.h>
#include <libmm-glib.h>

#include "config.h"
#include "gpio_power.h"
#include "health.h"
#include "mm.h"
#include "ppp.h"
#include "route.h"

typedef struct x8_app {
    GMainLoop *loop;
    gboolean once;
    x8_cellular_config config;
    x8_gpio_power gpio_power;
    x8_mm mm;
    x8_ppp ppp;
} x8_app;

static volatile sig_atomic_t g_stop_requested = 0;

static void handle_signal(int signo)
{
    (void)signo;
    g_stop_requested = 1;
}

static bool install_signal_handler(int signo)
{
    struct sigaction action;

    action.sa_handler = handle_signal;
    sigemptyset(&action.sa_mask);
    action.sa_flags = 0;

    return sigaction(signo, &action, NULL) == 0;
}

static gboolean check_shutdown(gpointer user_data)
{
    x8_app *app = user_data;

    if (!g_stop_requested) {
        return G_SOURCE_CONTINUE;
    }

    g_message("shutdown requested");
    g_main_loop_quit(app->loop);
    return G_SOURCE_REMOVE;
}

static bool run_supervisor_cycle(x8_app *app)
{
    g_autoptr(GError) error = NULL;

    g_type_ensure(MM_TYPE_MANAGER);

    g_message("x8-cellulard tick: ModemManager headers %d.%d.%d, libgpiod %s",
              MM_MAJOR_VERSION,
              MM_MINOR_VERSION,
              MM_MICRO_VERSION,
              gpiod_api_version());

    if (!x8_gpio_power_ensure(&app->gpio_power, &app->config)) {
        g_warning("supervisor: GPIO power ensure failed; retrying next cycle");
        return false;
    }

    if (!x8_mm_ensure_modems(&app->mm, &app->config, &error)) {
        g_warning("modemmanager ensure failed: %s",
                  error != NULL ? error->message : "unknown error");
        return false;
    }

    if (!x8_ppp_ensure(&app->ppp, &app->mm, &app->config, &error)) {
        g_warning("ppp ensure failed: %s",
                  error != NULL ? error->message : "unknown error");
        return false;
    }

    if (!x8_route_ensure(&app->config, &app->ppp, &error)) {
        g_warning("route ensure failed: %s",
                  error != NULL ? error->message : "unknown error");
        return false;
    }

    if (!x8_health_ensure(&app->config, &app->mm, &app->ppp, &error)) {
        g_warning("health ensure failed: %s",
                  error != NULL ? error->message : "unknown error");
        return false;
    }

    return true;
}

static gboolean supervisor_tick_once(gpointer user_data)
{
    x8_app *app = user_data;

    (void)run_supervisor_cycle(app);

    if (app->once) {
        g_main_loop_quit(app->loop);
    }

    return G_SOURCE_REMOVE;
}

static gboolean supervisor_tick_periodic(gpointer user_data)
{
    x8_app *app = user_data;

    (void)run_supervisor_cycle(app);
    return G_SOURCE_CONTINUE;
}

static void log_modem_config(const x8_modem_config *modem)
{
    g_message("modem slot %s: %s, match [%s] %s, enabled %s, apn %s",
              modem->name,
              modem->description,
              modem->match.manufacturer,
              modem->match.model,
              modem->enabled ? "true" : "false",
              modem->apn != NULL ? modem->apn : "<none>");
}

static void log_cellular_config(const x8_cellular_config *config)
{
    for (x8_modem_slot slot = X8_MODEM_SLOT_EXTERNAL;
         slot < X8_MODEM_SLOT_COUNT;
         slot++) {
        const x8_modem_config *modem =
            x8_cellular_config_get_modem(config, slot);

        if (modem != NULL) {
            log_modem_config(modem);
        }
    }
}

int main(int argc, char **argv)
{
    g_autoptr(GError) error = NULL;
    gboolean once = FALSE;
    gchar *external_apn = NULL;
    gchar *sara_apn = NULL;
    guint interval_sec = 30;
    GOptionEntry options[] = {
        {
            .long_name = "once",
            .arg = G_OPTION_ARG_NONE,
            .arg_data = &once,
            .description = "Run one supervisor tick and exit",
        },
        {
            .long_name = "interval-sec",
            .arg = G_OPTION_ARG_INT,
            .arg_data = &interval_sec,
            .description = "Seconds between supervisor ticks",
            .arg_description = "SECONDS",
        },
        {
            .long_name = "external-apn",
            .arg = G_OPTION_ARG_STRING,
            .arg_data = &external_apn,
            .description = "Enable the Max Carrier external modem with this APN",
            .arg_description = "APN",
        },
        {
            .long_name = "sara-apn",
            .arg = G_OPTION_ARG_STRING,
            .arg_data = &sara_apn,
            .description = "Enable the onboard SARA modem with this APN",
            .arg_description = "APN",
        },
        {0},
    };
    g_autoptr(GOptionContext) context = g_option_context_new(NULL);
    x8_cellular_config config;

    g_option_context_set_summary(context, "Portenta X8 cellular supervisor");
    g_option_context_add_main_entries(context, options, NULL);

    if (!g_option_context_parse(context, &argc, &argv, &error)) {
        g_printerr("x8-cellulard: %s\n", error->message);
        return EXIT_FAILURE;
    }

    if (interval_sec == 0) {
        g_printerr("x8-cellulard: --interval-sec must be greater than zero\n");
        return EXIT_FAILURE;
    }

    if (!install_signal_handler(SIGINT) || !install_signal_handler(SIGTERM)) {
        g_printerr("x8-cellulard: failed to install signal handler: %s\n",
                   g_strerror(errno));
        return EXIT_FAILURE;
    }

    x8_cellular_config_init(&config);
    if (external_apn != NULL && external_apn[0] != '\0') {
        x8_cellular_config_set_apn(&config,
                                   X8_MODEM_SLOT_EXTERNAL,
                                   external_apn);
    }
    if (sara_apn != NULL && sara_apn[0] != '\0') {
        x8_cellular_config_set_apn(&config, X8_MODEM_SLOT_SARA, sara_apn);
    }
    g_clear_pointer(&external_apn, g_free);
    g_clear_pointer(&sara_apn, g_free);

    if (!x8_cellular_config_any_enabled(&config)) {
        g_printerr("x8-cellulard: provide at least one APN parameter: --external-apn APN or --sara-apn APN\n");
        x8_cellular_config_clear(&config);
        return EXIT_FAILURE;
    }

    x8_app app = {
        .loop = g_main_loop_new(NULL, FALSE),
        .once = once,
        .config = config,
    };
    x8_gpio_power_init(&app.gpio_power);
    x8_mm_init(&app.mm);
    x8_ppp_init(&app.ppp);

    g_message("x8-cellulard starting");
    log_cellular_config(&app.config);

    g_timeout_add_seconds(1, check_shutdown, &app);
    g_idle_add(supervisor_tick_once, &app);
    if (!once) {
        g_timeout_add_seconds(interval_sec, supervisor_tick_periodic, &app);
    }

    g_main_loop_run(app.loop);
    g_main_loop_unref(app.loop);
    x8_ppp_clear(&app.ppp);
    x8_mm_clear(&app.mm);
    x8_gpio_power_clear(&app.gpio_power);
    x8_cellular_config_clear(&app.config);

    g_message("x8-cellulard stopped");
    return EXIT_SUCCESS;
}
