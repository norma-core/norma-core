#define _POSIX_C_SOURCE 200809L

#include "health.h"

#include <errno.h>
#include <signal.h>
#include <stdbool.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

#define X8_HEALTH_PING_TIMEOUT_SEC "2"
#define X8_HEALTH_PING_HARD_TIMEOUT_USEC (5 * G_USEC_PER_SEC)
#define X8_HEALTH_PING_WAIT_STEP_USEC 100000

static const char *const x8_health_targets[] = {
    "1.1.1.1",        /* Cloudflare */
    "8.8.8.8",        /* Google */
    "9.9.9.9",        /* Quad9 */
    "208.67.222.222", /* Cisco OpenDNS */
    "1.0.0.1",        /* Cloudflare secondary */
    "8.8.4.4",        /* Google secondary */
};

static GQuark x8_health_error_quark(void)
{
    return g_quark_from_static_string("x8-health-error");
}

static bool ping_target_on_interface(const char *ifname,
                                     const char *target,
                                     GError **error)
{
    GPid pid = 0;
    gint wait_status = 0;
    gchar *argv[] = {
        "ping",
        "-I",
        (char *)ifname,
        "-c",
        "1",
        "-W",
        X8_HEALTH_PING_TIMEOUT_SEC,
        (char *)target,
        NULL,
    };

    if (!g_spawn_async(NULL,
                       argv,
                       NULL,
                       G_SPAWN_SEARCH_PATH |
                           G_SPAWN_DO_NOT_REAP_CHILD |
                           G_SPAWN_STDOUT_TO_DEV_NULL |
                           G_SPAWN_STDERR_TO_DEV_NULL,
                       NULL,
                       NULL,
                       &pid,
                       error)) {
        g_prefix_error(error,
                       "health: ping %s via %s failed to start: ",
                       target,
                       ifname);
        return false;
    }

    const gint64 deadline =
        g_get_monotonic_time() + X8_HEALTH_PING_HARD_TIMEOUT_USEC;

    while (g_get_monotonic_time() < deadline) {
        pid_t result = waitpid(pid, &wait_status, WNOHANG);

        if (result == pid) {
            g_spawn_close_pid(pid);
            return WIFEXITED(wait_status) && WEXITSTATUS(wait_status) == 0;
        }

        if (result < 0) {
            g_set_error(error,
                        x8_health_error_quark(),
                        errno,
                        "health: ping %s via %s wait failed: %s",
                        target,
                        ifname,
                        g_strerror(errno));
            g_spawn_close_pid(pid);
            return false;
        }

        g_usleep(X8_HEALTH_PING_WAIT_STEP_USEC);
    }

    g_warning("health: ping %s via %s timed out after %u second(s); killing pid %d",
              target,
              ifname,
              (unsigned int)(X8_HEALTH_PING_HARD_TIMEOUT_USEC /
                             G_USEC_PER_SEC),
              (int)pid);
    if (kill(pid, SIGTERM) == 0) {
        for (unsigned int i = 0; i < 10; i++) {
            pid_t result = waitpid(pid, &wait_status, WNOHANG);

            if (result == pid) {
                g_spawn_close_pid(pid);
                return false;
            }

            if (result < 0) {
                break;
            }

            g_usleep(X8_HEALTH_PING_WAIT_STEP_USEC);
        }
    }

    kill(pid, SIGKILL);
    waitpid(pid, &wait_status, 0);
    g_spawn_close_pid(pid);
    return false;
}

static bool check_slot_targets(const x8_modem_config *modem,
                               const x8_ppp_slot *ppp_slot)
{
    bool command_failed_to_start = false;

    for (gsize i = 0; i < G_N_ELEMENTS(x8_health_targets); i++) {
        g_autoptr(GError) error = NULL;
        const char *target = x8_health_targets[i];

        if (ping_target_on_interface(ppp_slot->ifname, target, &error)) {
            g_message("health: slot %s %s reached %s",
                      modem->name,
                      ppp_slot->ifname,
                      target);
            return true;
        }

        if (error != NULL) {
            command_failed_to_start = true;
            g_warning("%s", error->message);
            continue;
        }

        g_message("health: slot %s %s did not reach %s",
                  modem->name,
                  ppp_slot->ifname,
                  target);
    }

    if (command_failed_to_start) {
        g_warning("health: slot %s could not start ping for at least one target",
                  modem->name);
    }

    g_warning("health: slot %s %s failed all %u internet target(s)",
              modem->name,
              ppp_slot->ifname,
              (unsigned int)G_N_ELEMENTS(x8_health_targets));
    return false;
}

static bool disconnect_slot_for_reconnect(const x8_cellular_config *config,
                                          x8_mm *mm,
                                          x8_ppp *ppp,
                                          const x8_modem_config *modem)
{
    const x8_mm_bearer_status *bearer = NULL;
    g_autoptr(GError) error = NULL;

    bearer = x8_mm_get_bearer_status(mm, modem->slot);
    if (bearer == NULL || !bearer->connected) {
        g_warning("health: slot %s failed checks but has no connected bearer to disconnect",
                  modem->name);
        return false;
    }

    g_message("health: slot %s disconnecting bearer %s after failed internet checks",
              modem->name,
              bearer->bearer_path != NULL ? bearer->bearer_path : "<unknown>");
    x8_ppp_reset_slot(ppp, modem->slot);
    if (!x8_mm_disconnect_and_disable_modem(mm, config, modem->slot, &error)) {
        g_warning("health: slot %s modem reset failed: %s",
                  modem->name,
                  error != NULL ? error->message : "unknown error");
        return false;
    }

    return true;
}

bool x8_health_ensure(const x8_cellular_config *config,
                      x8_mm *mm,
                      x8_ppp *ppp,
                      GError **error)
{
    bool any_ready = false;
    bool any_healthy = false;
    bool any_reconnect_queued = false;

    if (config == NULL || mm == NULL || ppp == NULL) {
        g_set_error_literal(error,
                            x8_health_error_quark(),
                            EINVAL,
                            "invalid health ensure arguments");
        return false;
    }

    for (x8_modem_slot slot = X8_MODEM_SLOT_EXTERNAL;
         slot < X8_MODEM_SLOT_COUNT;
         slot++) {
        const x8_modem_config *modem =
            x8_cellular_config_get_modem(config, slot);
        const x8_ppp_slot *ppp_slot = x8_ppp_get_slot(ppp, slot);

        if (modem == NULL || !modem->enabled || ppp_slot == NULL ||
            !ppp_slot->has_ipv4 || ppp_slot->ifname == NULL) {
            continue;
        }

        any_ready = true;
        if (check_slot_targets(modem, ppp_slot)) {
            any_healthy = true;
            continue;
        }

        if (disconnect_slot_for_reconnect(config, mm, ppp, modem)) {
            any_reconnect_queued = true;
        }
    }

    if (!any_ready) {
        g_message("health: no PPP interface with IPv4 ready for internet check");
        return true;
    }

    if (any_healthy) {
        return true;
    }

    if (any_reconnect_queued) {
        g_warning("health: all checked PPP data paths failed; modem reconnect queued for next supervisor cycle");
        return true;
    }

    g_set_error_literal(error,
                        x8_health_error_quark(),
                        ENETUNREACH,
                        "no PPP data path reached internet health targets and no modem reconnect was queued");
    return false;
}
