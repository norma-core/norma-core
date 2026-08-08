#define _POSIX_C_SOURCE 200809L

#include "route.h"

#include <errno.h>
#include <net/if.h>

#include <linux/rtnetlink.h>
#include <netlink/addr.h>
#include <netlink/netlink.h>
#include <netlink/route/nexthop.h>
#include <netlink/route/route.h>
#include <netlink/socket.h>

static GQuark x8_route_error_quark(void)
{
    return g_quark_from_static_string("x8-route-error");
}

static void set_nl_error(GError **error, int code, const char *context)
{
    g_set_error(error,
                x8_route_error_quark(),
                code < 0 ? -code : code,
                "%s: %s",
                context,
                nl_geterror(code));
}

static bool add_ppp_nexthop(struct rtnl_route *route,
                            const char *ifname,
                            GError **error)
{
    unsigned int ifindex;
    struct rtnl_nexthop *nexthop = NULL;

    ifindex = if_nametoindex(ifname);
    if (ifindex == 0) {
        g_set_error(error,
                    x8_route_error_quark(),
                    errno != 0 ? errno : ENODEV,
                    "route: interface %s has no ifindex: %s",
                    ifname,
                    g_strerror(errno != 0 ? errno : ENODEV));
        return false;
    }

    nexthop = rtnl_route_nh_alloc();
    if (nexthop == NULL) {
        g_set_error_literal(error,
                            x8_route_error_quark(),
                            ENOMEM,
                            "route: allocate nexthop failed");
        return false;
    }

    rtnl_route_nh_set_ifindex(nexthop, (int)ifindex);
    rtnl_route_add_nexthop(route, nexthop);
    return true;
}

bool x8_route_ensure(const x8_cellular_config *config,
                     const x8_ppp *ppp,
                     GError **error)
{
    g_autoptr(GError) local_error = NULL;
    struct nl_sock *sock = NULL;
    struct rtnl_route *route = NULL;
    struct nl_addr *dst = NULL;
    unsigned int nexthops = 0;
    int rc;

    if (config == NULL || ppp == NULL) {
        g_set_error_literal(error,
                            x8_route_error_quark(),
                            EINVAL,
                            "invalid route ensure arguments");
        return false;
    }

    route = rtnl_route_alloc();
    if (route == NULL) {
        g_set_error_literal(error,
                            x8_route_error_quark(),
                            ENOMEM,
                            "route: allocate default route failed");
        return false;
    }

    rc = nl_addr_parse("0.0.0.0/0", AF_INET, &dst);
    if (rc < 0) {
        set_nl_error(error, rc, "route: parse default destination");
        rtnl_route_put(route);
        return false;
    }

    rc = rtnl_route_set_family(route, AF_INET);
    if (rc < 0) {
        set_nl_error(error, rc, "route: set family");
        nl_addr_put(dst);
        rtnl_route_put(route);
        return false;
    }

    rtnl_route_set_table(route, RT_TABLE_MAIN);
    rtnl_route_set_scope(route, RT_SCOPE_LINK);
    rtnl_route_set_protocol(route, RTPROT_STATIC);

    rc = rtnl_route_set_type(route, RTN_UNICAST);
    if (rc < 0) {
        set_nl_error(error, rc, "route: set type");
        nl_addr_put(dst);
        rtnl_route_put(route);
        return false;
    }

    rc = rtnl_route_set_dst(route, dst);
    nl_addr_put(dst);
    if (rc < 0) {
        set_nl_error(error, rc, "route: set destination");
        rtnl_route_put(route);
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

        if (!add_ppp_nexthop(route, ppp_slot->ifname, &local_error)) {
            g_propagate_error(error, g_steal_pointer(&local_error));
            rtnl_route_put(route);
            return false;
        }

        g_message("route: slot %s contributes default route nexthop dev %s",
                  modem->name,
                  ppp_slot->ifname);
        nexthops++;
    }

    if (nexthops == 0) {
        g_message("route: no PPP interface with IPv4 yet");
        rtnl_route_put(route);
        return true;
    }

    sock = nl_socket_alloc();
    if (sock == NULL) {
        g_set_error_literal(error,
                            x8_route_error_quark(),
                            ENOMEM,
                            "route: allocate netlink socket failed");
        rtnl_route_put(route);
        return false;
    }

    rc = nl_connect(sock, NETLINK_ROUTE);
    if (rc < 0) {
        set_nl_error(error, rc, "route: connect netlink route socket");
        nl_socket_free(sock);
        rtnl_route_put(route);
        return false;
    }

    rc = rtnl_route_add(sock, route, NLM_F_CREATE | NLM_F_REPLACE);
    nl_socket_free(sock);
    rtnl_route_put(route);
    if (rc < 0) {
        set_nl_error(error, rc, "route: install IPv4 default route");
        return false;
    }

    g_message("route: ensured IPv4 default route with %u PPP nexthop(s)",
              nexthops);
    return true;
}
