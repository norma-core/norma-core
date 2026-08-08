#define _POSIX_C_SOURCE 200809L

#include "ppp.h"

#include <errno.h>
#include <ifaddrs.h>
#include <signal.h>
#include <stdbool.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

#include <gio/gio.h>
#include <glib.h>

#define X8_PPP_LOCK_DIR "/var/run/pppd/lock"
#define X8_PPP_WAIT_ATTEMPTS 40
#define X8_PPP_WAIT_USEC G_USEC_PER_SEC
#define X8_PPP_STOP_WAIT_ATTEMPTS 50

static bool slot_is_valid(x8_modem_slot slot)
{
    return slot == X8_MODEM_SLOT_EXTERNAL || slot == X8_MODEM_SLOT_SARA;
}

static GQuark x8_ppp_error_quark(void)
{
    return g_quark_from_static_string("x8-ppp-error");
}

static unsigned int ppp_unit_for_slot(x8_modem_slot slot)
{
    switch (slot) {
    case X8_MODEM_SLOT_EXTERNAL:
        return 0;
    case X8_MODEM_SLOT_SARA:
        return 1;
    case X8_MODEM_SLOT_COUNT:
        break;
    }

    return 0;
}

static char *ppp_ifname_for_slot(x8_modem_slot slot)
{
    return g_strdup_printf("ppp%u", ppp_unit_for_slot(slot));
}

static char *ppp_linkname_for_slot(x8_modem_slot slot)
{
    return g_strdup_printf("x8-cellulard-%s", x8_modem_slot_name(slot));
}

static char *tty_path_from_interface(const char *interface)
{
    if (interface == NULL || interface[0] == '\0') {
        return NULL;
    }

    if (g_str_has_prefix(interface, "/dev/")) {
        return g_strdup(interface);
    }

    return g_strdup_printf("/dev/%s", interface);
}

static bool ppp_interface_has_ipv4(const char *ifname)
{
    struct ifaddrs *ifaddr = NULL;
    bool found = false;

    if (ifname == NULL || getifaddrs(&ifaddr) != 0) {
        return false;
    }

    for (struct ifaddrs *ifa = ifaddr; ifa != NULL; ifa = ifa->ifa_next) {
        if (ifa->ifa_name == NULL || ifa->ifa_addr == NULL) {
            continue;
        }

        if (g_strcmp0(ifa->ifa_name, ifname) == 0 &&
            ifa->ifa_addr->sa_family == AF_INET) {
            found = true;
            break;
        }
    }

    freeifaddrs(ifaddr);
    return found;
}

static void clear_slot(x8_ppp_slot *slot)
{
    if (slot == NULL) {
        return;
    }

    g_clear_pointer(&slot->bearer_path, g_free);
    g_clear_pointer(&slot->tty_path, g_free);
    g_clear_pointer(&slot->ifname, g_free);
    slot->has_ipv4 = false;
}

static void reap_slot_process(x8_ppp_slot *slot, const char *slot_name)
{
    int status = 0;
    pid_t result;

    if (slot == NULL || slot->pid <= 0) {
        return;
    }

    result = waitpid(slot->pid, &status, WNOHANG);
    if (result == 0) {
        return;
    }

    if (result < 0) {
        if (errno != ECHILD) {
            g_warning("ppp: slot %s pppd pid %d wait failed: %s",
                      slot_name,
                      (int)slot->pid,
                      g_strerror(errno));
        }
    } else if (WIFEXITED(status)) {
        g_warning("ppp: slot %s pppd pid %d exited status %d",
                  slot_name,
                  (int)slot->pid,
                  WEXITSTATUS(status));
    } else if (WIFSIGNALED(status)) {
        g_warning("ppp: slot %s pppd pid %d killed by signal %d",
                  slot_name,
                  (int)slot->pid,
                  WTERMSIG(status));
    }

    g_spawn_close_pid(slot->pid);
    slot->pid = 0;
    slot->has_ipv4 = false;
}

static bool process_is_alive(GPid pid)
{
    if (pid <= 0) {
        return false;
    }

    if (kill(pid, 0) == 0) {
        return true;
    }

    return errno == EPERM;
}

static void stop_slot_process(x8_ppp_slot *slot, const char *slot_name)
{
    if (slot == NULL || slot->pid <= 0) {
        return;
    }

    g_message("ppp: slot %s stopping pppd pid %d", slot_name, (int)slot->pid);
    if (kill(slot->pid, SIGTERM) == 0) {
        for (unsigned int i = 0; i < X8_PPP_STOP_WAIT_ATTEMPTS; i++) {
            reap_slot_process(slot, slot_name);
            if (slot->pid <= 0) {
                return;
            }
            g_usleep(100000);
        }
    }

    if (slot->pid > 0 && kill(slot->pid, SIGKILL) == 0) {
        for (unsigned int i = 0; i < X8_PPP_STOP_WAIT_ATTEMPTS; i++) {
            reap_slot_process(slot, slot_name);
            if (slot->pid <= 0) {
                return;
            }
            g_usleep(100000);
        }
    }
}

static bool slot_matches_bearer(const x8_ppp_slot *slot,
                                const x8_mm_bearer_status *bearer)
{
    g_autofree char *tty_path = NULL;

    if (slot == NULL || bearer == NULL) {
        return false;
    }

    tty_path = tty_path_from_interface(bearer->interface);
    return g_strcmp0(slot->bearer_path, bearer->bearer_path) == 0 &&
           g_strcmp0(slot->tty_path, tty_path) == 0;
}

static void reset_slot_for_bearer(x8_ppp_slot *slot,
                                  x8_modem_slot modem_slot,
                                  const x8_mm_bearer_status *bearer)
{
    clear_slot(slot);
    slot->bearer_path = g_strdup(bearer->bearer_path);
    slot->tty_path = tty_path_from_interface(bearer->interface);
    slot->ifname = ppp_ifname_for_slot(modem_slot);
}

static bool start_pppd(x8_ppp_slot *slot,
                       x8_modem_slot modem_slot,
                       GError **error)
{
    g_autofree char *unit = g_strdup_printf("%u", ppp_unit_for_slot(modem_slot));
    g_autofree char *linkname = ppp_linkname_for_slot(modem_slot);
    gchar *argv[] = {
        "pppd",
        slot->tty_path,
        "115200",
        "noauth",
        "nodetach",
        "debug",
        "noipdefault",
        "novj",
        "noccp",
        "noipv6",
        "nodefaultroute",
        "unit",
        unit,
        "linkname",
        linkname,
        "ipparam",
        (char *)x8_modem_slot_name(modem_slot),
        NULL,
    };

    if (g_mkdir_with_parents(X8_PPP_LOCK_DIR, 0755) != 0) {
        g_set_error(error,
                    x8_ppp_error_quark(),
                    errno,
                    "create " X8_PPP_LOCK_DIR ": %s",
                    g_strerror(errno));
        return false;
    }

    g_message("ppp: slot %s starting pppd on %s as %s",
              x8_modem_slot_name(modem_slot),
              slot->tty_path,
              slot->ifname);
    if (!g_spawn_async(NULL,
                       argv,
                       NULL,
                       G_SPAWN_SEARCH_PATH | G_SPAWN_DO_NOT_REAP_CHILD,
                       NULL,
                       NULL,
                       &slot->pid,
                       error)) {
        g_prefix_error(error,
                       "slot %s start pppd on %s failed: ",
                       x8_modem_slot_name(modem_slot),
                       slot->tty_path);
        return false;
    }

    return true;
}

static bool wait_for_ppp_ipv4(x8_ppp_slot *slot, x8_modem_slot modem_slot)
{
    for (unsigned int attempt = 1; attempt <= X8_PPP_WAIT_ATTEMPTS; attempt++) {
        reap_slot_process(slot, x8_modem_slot_name(modem_slot));

        if (ppp_interface_has_ipv4(slot->ifname)) {
            g_message("ppp: slot %s %s has IPv4",
                      x8_modem_slot_name(modem_slot),
                      slot->ifname);
            return true;
        }

        if (slot->pid <= 0 || !process_is_alive(slot->pid)) {
            g_warning("ppp: slot %s pppd is not running before %s got IPv4",
                      x8_modem_slot_name(modem_slot),
                      slot->ifname);
            return false;
        }

        if (attempt < X8_PPP_WAIT_ATTEMPTS) {
            g_usleep(X8_PPP_WAIT_USEC);
        }
    }

    g_warning("ppp: slot %s %s has no IPv4 after %u second(s)",
              x8_modem_slot_name(modem_slot),
              slot->ifname,
              X8_PPP_WAIT_ATTEMPTS);
    return false;
}

void x8_ppp_init(x8_ppp *ppp)
{
    if (ppp == NULL) {
        return;
    }

    *ppp = (x8_ppp){0};
}

void x8_ppp_clear(x8_ppp *ppp)
{
    if (ppp == NULL) {
        return;
    }

    for (x8_modem_slot slot = X8_MODEM_SLOT_EXTERNAL;
         slot < X8_MODEM_SLOT_COUNT;
         slot++) {
        stop_slot_process(&ppp->slots[slot], x8_modem_slot_name(slot));
        clear_slot(&ppp->slots[slot]);
    }
}

bool x8_ppp_ensure(x8_ppp *ppp,
                   x8_mm *mm,
                   const x8_cellular_config *config,
                   GError **error)
{
    bool any_ppp_required = false;
    bool any_working = false;
    bool any_retry_queued = false;

    if (ppp == NULL || mm == NULL || config == NULL) {
        g_set_error_literal(error,
                            x8_ppp_error_quark(),
                            EINVAL,
                            "invalid PPP ensure arguments");
        return false;
    }

    for (x8_modem_slot slot = X8_MODEM_SLOT_EXTERNAL;
         slot < X8_MODEM_SLOT_COUNT;
         slot++) {
        const x8_modem_config *modem =
            x8_cellular_config_get_modem(config, slot);
        const x8_mm_bearer_status *bearer =
            x8_mm_get_bearer_status(mm, slot);
        x8_ppp_slot *ppp_slot = &ppp->slots[slot];
        g_autoptr(GError) slot_error = NULL;

        reap_slot_process(ppp_slot, x8_modem_slot_name(slot));

        if (modem == NULL || !modem->enabled || bearer == NULL ||
            !bearer->connected) {
            stop_slot_process(ppp_slot, x8_modem_slot_name(slot));
            clear_slot(ppp_slot);
            continue;
        }

        if (bearer->ipv4_method != X8_MM_IP_METHOD_PPP) {
            g_message("ppp: slot %s bearer %s ipv4 method %s does not need PPP",
                      modem->name,
                      bearer->bearer_path != NULL ? bearer->bearer_path
                                                  : "<unknown>",
                      x8_mm_ip_method_name(bearer->ipv4_method));
            any_working = true;
            continue;
        }

        any_ppp_required = true;
        if (!slot_matches_bearer(ppp_slot, bearer)) {
            stop_slot_process(ppp_slot, modem->name);
            reset_slot_for_bearer(ppp_slot, slot, bearer);
        }

        if (ppp_interface_has_ipv4(ppp_slot->ifname)) {
            g_message("ppp: slot %s %s already has IPv4 for bearer %s",
                      modem->name,
                      ppp_slot->ifname,
                      bearer->bearer_path);
            ppp_slot->has_ipv4 = true;
            any_working = true;
            continue;
        }
        ppp_slot->has_ipv4 = false;

        if (ppp_slot->pid <= 0 &&
            !start_pppd(ppp_slot, slot, &slot_error)) {
            g_warning("ppp: slot %s failed: %s",
                      modem->name,
                      slot_error != NULL ? slot_error->message
                                         : "unknown error");
        }

        if (ppp_slot->pid > 0 && wait_for_ppp_ipv4(ppp_slot, slot)) {
            ppp_slot->has_ipv4 = true;
            any_working = true;
            continue;
        }

        ppp_slot->has_ipv4 = false;
        stop_slot_process(ppp_slot, modem->name);
        clear_slot(ppp_slot);

        if (!x8_mm_disconnect_bearer(mm, slot, &slot_error)) {
            g_warning("ppp: slot %s could not disconnect failed bearer: %s",
                      modem->name,
                      slot_error != NULL ? slot_error->message
                                         : "unknown error");
        } else {
            any_retry_queued = true;
        }
    }

    if (!any_ppp_required || any_working) {
        return true;
    }

    if (any_retry_queued) {
        g_warning("ppp: no PPP data path has IPv4 yet; bearer reconnect queued for next supervisor tick");
        return true;
    }

    g_set_error_literal(error,
                        x8_ppp_error_quark(),
                        ENODEV,
                        "no PPP data path has IPv4");
    return false;
}

const x8_ppp_slot *x8_ppp_get_slot(const x8_ppp *ppp, x8_modem_slot slot)
{
    if (ppp == NULL || !slot_is_valid(slot)) {
        return NULL;
    }

    return &ppp->slots[slot];
}

void x8_ppp_reset_slot(x8_ppp *ppp, x8_modem_slot slot)
{
    if (ppp == NULL || !slot_is_valid(slot)) {
        return;
    }

    stop_slot_process(&ppp->slots[slot], x8_modem_slot_name(slot));
    clear_slot(&ppp->slots[slot]);
}
