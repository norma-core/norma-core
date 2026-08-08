#define _POSIX_C_SOURCE 200809L

#include "mm.h"

#include <errno.h>

#include <gio/gio.h>
#include <glib.h>
#include <libmm-glib.h>

#define X8_MM_MAX_ATTEMPTS 5
#define X8_MM_RETRY_USEC G_USEC_PER_SEC

typedef enum x8_mm_slot_result {
    X8_MM_SLOT_RESULT_FAILED = 0,
    X8_MM_SLOT_RESULT_PENDING,
    X8_MM_SLOT_RESULT_HELD,
    X8_MM_SLOT_RESULT_ENSURED,
} x8_mm_slot_result;

static GQuark x8_mm_error_quark(void)
{
    return g_quark_from_static_string("x8-mm-error");
}

static const char *display_string(const char *value)
{
    return value != NULL && value[0] != '\0' ? value : "<unknown>";
}

static const char *modem_state_name(MMModemState state)
{
    const char *name = mm_modem_state_get_string(state);

    return name != NULL ? name : "unknown";
}

static const char *modem_failed_reason_name(MMModemStateFailedReason reason)
{
    const char *name = mm_modem_state_failed_reason_get_string(reason);

    return name != NULL ? name : "unknown";
}

static bool modem_failed_reason_is_held(MMModemStateFailedReason reason)
{
    return reason == MM_MODEM_STATE_FAILED_REASON_SIM_MISSING ||
           reason == MM_MODEM_STATE_FAILED_REASON_SIM_ERROR ||
           reason == MM_MODEM_STATE_FAILED_REASON_ESIM_WITHOUT_PROFILES;
}

static bool simple_connect_error_is_held(const GError *error)
{
    return error != NULL &&
           (g_error_matches(error,
                            MM_MOBILE_EQUIPMENT_ERROR,
                            MM_MOBILE_EQUIPMENT_ERROR_MISSING_OR_UNKNOWN_APN) ||
            g_error_matches(error,
                            MM_MOBILE_EQUIPMENT_ERROR,
                            MM_MOBILE_EQUIPMENT_ERROR_REQUESTED_APN_NOT_SUPPORTED) ||
            g_error_matches(error,
                            MM_MOBILE_EQUIPMENT_ERROR,
                            MM_MOBILE_EQUIPMENT_ERROR_APN_RESTRICTION_INCOMPATIBLE) ||
            g_error_matches(error,
                            MM_MOBILE_EQUIPMENT_ERROR,
                            MM_MOBILE_EQUIPMENT_ERROR_PDP_AUTH_FAILURE) ||
            g_error_matches(error,
                            MM_MOBILE_EQUIPMENT_ERROR,
                            MM_MOBILE_EQUIPMENT_ERROR_SERVICE_OPTION_NOT_AUTHORIZED_IN_PLMN));
}

static const char *bearer_profile_source_name(MMBearerProfileSource source)
{
    const char *name = mm_bearer_profile_source_get_string(source);

    return name != NULL ? name : "unknown";
}

static const char *bearer_ip_method_name(MMBearerIpMethod method)
{
    const char *name = mm_bearer_ip_method_get_string(method);

    return name != NULL ? name : "unknown";
}

const char *x8_mm_ip_method_name(x8_mm_ip_method method)
{
    switch (method) {
    case X8_MM_IP_METHOD_UNKNOWN:
        return "unknown";
    case X8_MM_IP_METHOD_PPP:
        return "ppp";
    case X8_MM_IP_METHOD_STATIC:
        return "static";
    case X8_MM_IP_METHOD_DHCP:
        return "dhcp";
    }

    return "unknown";
}

static MMBearerIpMethod bearer_ipv4_method(MMBearer *bearer)
{
    g_autoptr(MMBearerIpConfig) ipv4 = mm_bearer_get_ipv4_config(bearer);

    return ipv4 != NULL ? mm_bearer_ip_config_get_method(ipv4)
                        : MM_BEARER_IP_METHOD_UNKNOWN;
}

static x8_mm_ip_method x8_mm_ip_method_from_mm(MMBearerIpMethod method)
{
    switch (method) {
    case MM_BEARER_IP_METHOD_PPP:
        return X8_MM_IP_METHOD_PPP;
    case MM_BEARER_IP_METHOD_STATIC:
        return X8_MM_IP_METHOD_STATIC;
    case MM_BEARER_IP_METHOD_DHCP:
        return X8_MM_IP_METHOD_DHCP;
    case MM_BEARER_IP_METHOD_UNKNOWN:
        break;
    }

    return X8_MM_IP_METHOD_UNKNOWN;
}

static bool slot_is_valid(x8_modem_slot slot)
{
    return slot == X8_MODEM_SLOT_EXTERNAL || slot == X8_MODEM_SLOT_SARA;
}

static void clear_bearer_status(x8_mm_bearer_status *status)
{
    if (status == NULL) {
        return;
    }

    g_clear_pointer(&status->bearer_path, g_free);
    g_clear_pointer(&status->interface, g_free);
    g_clear_pointer(&status->apn, g_free);
    *status = (x8_mm_bearer_status){
        .slot = status->slot,
        .ipv4_method = X8_MM_IP_METHOD_UNKNOWN,
    };
}

static void clear_slot_state(x8_mm_slot_state *slot)
{
    if (slot == NULL) {
        return;
    }

    g_clear_object(&slot->bearer);
    clear_bearer_status(&slot->bearer_status);
}

static void record_connected_bearer(x8_mm *mm,
                                    const x8_modem_config *config,
                                    MMBearer *bearer,
                                    const char *apn,
                                    MMBearerIpMethod ipv4_method)
{
    x8_mm_slot_state *slot = NULL;
    x8_mm_bearer_status *status = NULL;

    if (mm == NULL || config == NULL || bearer == NULL ||
        !slot_is_valid(config->slot)) {
        return;
    }

    slot = &mm->slots[config->slot];
    clear_slot_state(slot);

    slot->bearer = g_object_ref(bearer);
    status = &slot->bearer_status;
    status->connected = true;
    status->slot = config->slot;
    status->bearer_path = g_strdup(mm_bearer_get_path(bearer));
    status->interface = g_strdup(mm_bearer_get_interface(bearer));
    status->apn = g_strdup(apn);
    status->ipv4_method = x8_mm_ip_method_from_mm(ipv4_method);
}

static bool modem_identity_matches(const x8_modem_config *config,
                                   const char *manufacturer,
                                   const char *model)
{
    if (manufacturer == NULL || model == NULL) {
        return false;
    }

    return g_ascii_strcasecmp(manufacturer, config->match.manufacturer) == 0 &&
           g_ascii_strcasecmp(model, config->match.model) == 0;
}

static bool modem_state_is_usable(MMModemState state)
{
    return state >= MM_MODEM_STATE_ENABLED;
}

static bool mm_connect(x8_mm *mm, GError **error)
{
    g_autoptr(GDBusConnection) connection = NULL;

    g_clear_object(&mm->manager);

    connection = g_bus_get_sync(G_BUS_TYPE_SYSTEM, NULL, error);
    if (connection == NULL) {
        return false;
    }

    mm->manager = mm_manager_new_sync(connection,
                                      G_DBUS_OBJECT_MANAGER_CLIENT_FLAGS_NONE,
                                      NULL,
                                      error);
    if (mm->manager == NULL) {
        return false;
    }

    if (!mm->logged_manager) {
        g_message("modemmanager: connected, daemon version %s",
                  display_string(mm_manager_get_version(mm->manager)));
        mm->logged_manager = true;
    }

    return true;
}

static GList *mm_get_objects(x8_mm *mm)
{
    return g_dbus_object_manager_get_objects(G_DBUS_OBJECT_MANAGER(mm->manager));
}

static void log_mm_objects(GList *objects)
{
    for (GList *node = objects; node != NULL; node = node->next) {
        MMObject *object = NULL;
        g_autoptr(MMModem) modem = NULL;
        const char *path = NULL;
        const char *manufacturer = NULL;
        const char *model = NULL;
        MMModemState state;

        if (!MM_IS_OBJECT(node->data)) {
            continue;
        }

        object = MM_OBJECT(node->data);
        modem = mm_object_get_modem(object);
        if (modem == NULL) {
            continue;
        }

        path = mm_modem_get_path(modem);
        manufacturer = mm_modem_get_manufacturer(modem);
        model = mm_modem_get_model(modem);
        state = mm_modem_get_state(modem);

        if (state == MM_MODEM_STATE_FAILED) {
            g_message("modemmanager: seen %s [%s] %s state %s, failed reason %s",
                      display_string(path),
                      display_string(manufacturer),
                      display_string(model),
                      modem_state_name(state),
                      modem_failed_reason_name(
                          mm_modem_get_state_failed_reason(modem)));
            continue;
        }

        g_message("modemmanager: seen %s [%s] %s state %s",
                  display_string(path),
                  display_string(manufacturer),
                  display_string(model),
                  modem_state_name(state));
    }
}

static MMObject *find_matching_object(GList *objects,
                                      const x8_modem_config *config)
{
    for (GList *node = objects; node != NULL; node = node->next) {
        MMObject *object = NULL;
        g_autoptr(MMModem) candidate = NULL;
        const char *manufacturer = NULL;
        const char *model = NULL;
        bool matches = false;

        if (!MM_IS_OBJECT(node->data)) {
            continue;
        }

        object = MM_OBJECT(node->data);
        candidate = mm_object_get_modem(object);
        if (candidate == NULL) {
            continue;
        }

        manufacturer = mm_modem_get_manufacturer(candidate);
        model = mm_modem_get_model(candidate);

        matches = modem_identity_matches(config, manufacturer, model);
        if (matches) {
            return g_object_ref(object);
        }
    }

    return NULL;
}

static void log_3gpp_profiles(const x8_modem_config *config,
                              MMObject *object,
                              const char *modem_path)
{
    g_autoptr(MMModem3gppProfileManager) profile_manager = NULL;
    g_autoptr(GError) error = NULL;
    GList *profiles = NULL;

    profile_manager = mm_object_get_modem_3gpp_profile_manager(object);
    if (profile_manager == NULL) {
        g_message("modemmanager: slot %s matched %s has no 3GPP profile manager",
                  config->name,
                  display_string(modem_path));
        return;
    }

    if (!mm_modem_3gpp_profile_manager_list_sync(profile_manager,
                                                 NULL,
                                                 &profiles,
                                                 &error)) {
        g_warning("modemmanager: slot %s matched %s could not list 3GPP profiles: %s",
                  config->name,
                  display_string(modem_path),
                  error != NULL ? error->message : "unknown error");
        return;
    }

    g_message("modemmanager: slot %s matched %s has %u 3GPP profile(s)",
              config->name,
              display_string(modem_path),
              g_list_length(profiles));

    for (GList *node = profiles; node != NULL; node = node->next) {
        MM3gppProfile *profile = MM_3GPP_PROFILE(node->data);
        g_autofree char *ip_type = NULL;
        g_autofree char *apn_type = NULL;

        ip_type = mm_bearer_ip_family_build_string_from_mask(
            mm_3gpp_profile_get_ip_type(profile));
        apn_type = mm_bearer_apn_type_build_string_from_mask(
            mm_3gpp_profile_get_apn_type(profile));

        g_message("modemmanager: slot %s profile id %d, name %s, apn %s, apn type %s, ip %s, enabled %s, source %s",
                  config->name,
                  mm_3gpp_profile_get_profile_id(profile),
                  display_string(mm_3gpp_profile_get_profile_name(profile)),
                  display_string(mm_3gpp_profile_get_apn(profile)),
                  display_string(apn_type),
                  display_string(ip_type),
                  mm_3gpp_profile_get_enabled(profile) ? "true" : "false",
                  bearer_profile_source_name(
                      mm_3gpp_profile_get_profile_source(profile)));
    }

    g_list_free_full(profiles, g_object_unref);
}

static bool apn_matches(const char *left, const char *right)
{
    return left != NULL && right != NULL && g_ascii_strcasecmp(left, right) == 0;
}

static bool modem_has_connected_bearer_for_apn(x8_mm *mm,
                                               const x8_modem_config *config,
                                               MMModem *modem,
                                               GError **error)
{
    GList *bearers = NULL;
    bool connected = false;

    bearers = mm_modem_list_bearers_sync(modem, NULL, error);
    if (bearers == NULL && error != NULL && *error != NULL) {
        g_prefix_error(error,
                       "slot %s matched %s could not list bearers: ",
                       config->name,
                       display_string(mm_modem_get_path(modem)));
        return false;
    }

    for (GList *node = bearers; node != NULL; node = node->next) {
        MMBearer *bearer = MM_BEARER(node->data);
        g_autoptr(MMBearerProperties) properties = NULL;
        g_autofree char *apn_type = NULL;
        const char *path = mm_bearer_get_path(bearer);
        const char *interface = mm_bearer_get_interface(bearer);
        const char *bearer_apn = NULL;
        gboolean bearer_connected = mm_bearer_get_connected(bearer);
        gint bearer_profile_id = mm_bearer_get_profile_id(bearer);
        MMBearerIpMethod ipv4_method = bearer_ipv4_method(bearer);

        properties = mm_bearer_get_properties(bearer);
        if (properties != NULL) {
            bearer_apn = mm_bearer_properties_get_apn(properties);
            apn_type = mm_bearer_apn_type_build_string_from_mask(
                mm_bearer_properties_get_apn_type(properties));
        }

        g_message("modemmanager: slot %s bearer %s connected %s interface %s ipv4 method %s profile id %d apn %s apn type %s",
                  config->name,
                  display_string(path),
                  bearer_connected ? "true" : "false",
                  display_string(interface),
                  bearer_ip_method_name(ipv4_method),
                  bearer_profile_id,
                  display_string(bearer_apn),
                  display_string(apn_type));

        if (bearer_connected && ipv4_method == MM_BEARER_IP_METHOD_PPP) {
            g_message("modemmanager: slot %s bearer %s needs PPP on %s for IP/DNS",
                      config->name,
                      display_string(path),
                      display_string(interface));
        }

        if (bearer_connected && apn_matches(bearer_apn, config->apn)) {
            record_connected_bearer(mm,
                                    config,
                                    bearer,
                                    bearer_apn,
                                    ipv4_method);
            connected = true;
        } else if (bearer_connected) {
            g_message("modemmanager: slot %s ignoring connected bearer %s apn %s, target apn %s",
                      config->name,
                      display_string(path),
                      display_string(bearer_apn),
                      display_string(config->apn));
        }
    }

    g_list_free_full(bearers, g_object_unref);
    return connected;
}

static x8_mm_slot_result ensure_modem_connected(const x8_modem_config *config,
                                                x8_mm *mm,
                                                MMObject *object,
                                                MMModem *modem,
                                                GError **error)
{
    g_autoptr(MMSimpleConnectProperties) properties = NULL;
    g_autoptr(MMBearer) bearer = NULL;
    g_autoptr(MMBearerProperties) bearer_properties = NULL;
    g_autoptr(MMModemSimple) simple = NULL;
    const char *bearer_apn = NULL;
    MMBearerIpMethod ipv4_method = MM_BEARER_IP_METHOD_UNKNOWN;

    if (config->apn == NULL || config->apn[0] == '\0') {
        g_set_error(error,
                    x8_mm_error_quark(),
                    EINVAL,
                    "slot %s has no APN parameter",
                    config->name);
        return X8_MM_SLOT_RESULT_FAILED;
    }

    log_3gpp_profiles(config, object, mm_modem_get_path(modem));

    if (modem_has_connected_bearer_for_apn(mm, config, modem, error)) {
        g_message("modemmanager: slot %s already has a connected bearer for APN %s",
                  config->name,
                  config->apn);
        return X8_MM_SLOT_RESULT_ENSURED;
    }

    if (error != NULL && *error != NULL) {
        return X8_MM_SLOT_RESULT_FAILED;
    }

    simple = mm_object_get_modem_simple(object);
    if (simple == NULL) {
        g_set_error(error,
                    x8_mm_error_quark(),
                    ENOENT,
                    "slot %s matched %s has no simple modem interface",
                    config->name,
                    display_string(mm_modem_get_path(modem)));
        return X8_MM_SLOT_RESULT_FAILED;
    }

    properties = mm_simple_connect_properties_new();
    if (properties == NULL) {
        g_set_error_literal(error,
                            x8_mm_error_quark(),
                            ENOMEM,
                            "allocate simple connect properties: out of memory");
        return X8_MM_SLOT_RESULT_FAILED;
    }

    mm_simple_connect_properties_set_apn(properties, config->apn);
    g_message("modemmanager: slot %s connecting with APN %s",
              config->name,
              config->apn);

    bearer = mm_modem_simple_connect_sync(simple, properties, NULL, error);
    if (bearer == NULL) {
        bool held = error != NULL && simple_connect_error_is_held(*error);

        g_prefix_error(error,
                       "slot %s APN %s simple connect failed: ",
                       config->name,
                       config->apn);
        return held ? X8_MM_SLOT_RESULT_HELD : X8_MM_SLOT_RESULT_FAILED;
    }

    bearer_properties = mm_bearer_get_properties(bearer);
    if (bearer_properties != NULL) {
        bearer_apn = mm_bearer_properties_get_apn(bearer_properties);
    }
    ipv4_method = bearer_ipv4_method(bearer);

    g_message("modemmanager: slot %s connected bearer %s interface %s ipv4 method %s profile id %d apn %s",
              config->name,
              display_string(mm_bearer_get_path(bearer)),
              display_string(mm_bearer_get_interface(bearer)),
              bearer_ip_method_name(ipv4_method),
              mm_bearer_get_profile_id(bearer),
              display_string(bearer_apn));
    if (ipv4_method == MM_BEARER_IP_METHOD_PPP) {
        g_message("modemmanager: slot %s connected bearer %s needs PPP on %s for IP/DNS",
                  config->name,
                  display_string(mm_bearer_get_path(bearer)),
                  display_string(mm_bearer_get_interface(bearer)));
    }
    record_connected_bearer(mm, config, bearer, bearer_apn, ipv4_method);
    return X8_MM_SLOT_RESULT_ENSURED;
}

static x8_mm_slot_result enable_modem_if_needed(const x8_modem_config *config,
                                                MMModem *modem,
                                                GError **error)
{
    const char *path = mm_modem_get_path(modem);
    MMModemState state = mm_modem_get_state(modem);

    if (modem_state_is_usable(state)) {
        g_message("modemmanager: slot %s matched %s and is already %s",
                  config->name,
                  display_string(path),
                  modem_state_name(state));
        return X8_MM_SLOT_RESULT_ENSURED;
    }

    if (state == MM_MODEM_STATE_FAILED) {
        MMModemStateFailedReason reason =
            mm_modem_get_state_failed_reason(modem);

        g_set_error(error,
                    x8_mm_error_quark(),
                    EIO,
                    "slot %s matched %s but modem state is failed: %s",
                    config->name,
                    display_string(path),
                    modem_failed_reason_name(reason));
        return modem_failed_reason_is_held(reason) ? X8_MM_SLOT_RESULT_HELD
                                                   : X8_MM_SLOT_RESULT_FAILED;
    }

    if (state == MM_MODEM_STATE_ENABLING) {
        g_message("modemmanager: slot %s matched %s is still enabling",
                  config->name,
                  display_string(path));
        return X8_MM_SLOT_RESULT_PENDING;
    }

    g_message("modemmanager: slot %s matched %s state %s; enabling",
              config->name,
              display_string(path),
              modem_state_name(state));

    if (!mm_modem_enable_sync(modem, NULL, error)) {
        g_prefix_error(error,
                       "slot %s matched %s state %s failed to enable: ",
                       config->name,
                       display_string(path),
                       modem_state_name(state));
        return X8_MM_SLOT_RESULT_FAILED;
    }

    g_message("modemmanager: slot %s matched %s enable requested; waiting for ModemManager state refresh",
              config->name,
              display_string(path));
    return X8_MM_SLOT_RESULT_PENDING;
}

static x8_mm_slot_result ensure_one_modem_attempt(
    x8_mm *mm,
    GList *objects,
    const x8_modem_config *config,
    GError **error)
{
    g_autoptr(MMObject) object = find_matching_object(objects, config);
    g_autoptr(MMModem) modem = NULL;
    x8_mm_slot_result result;

    if (object == NULL) {
        g_set_error(error,
                    x8_mm_error_quark(),
                    ENOENT,
                    "slot %s [%s] %s is not listed by ModemManager",
                    config->name,
                    config->match.manufacturer,
                    config->match.model);
        return X8_MM_SLOT_RESULT_FAILED;
    }

    modem = mm_object_get_modem(object);
    if (modem == NULL) {
        g_set_error(error,
                    x8_mm_error_quark(),
                    ENOENT,
                    "slot %s matched object has no modem interface",
                    config->name);
        return X8_MM_SLOT_RESULT_FAILED;
    }

    result = enable_modem_if_needed(config, modem, error);
    if (result != X8_MM_SLOT_RESULT_ENSURED) {
        return result;
    }

    return ensure_modem_connected(config, mm, object, modem, error);
}

void x8_mm_init(x8_mm *mm)
{
    if (mm == NULL) {
        return;
    }

    *mm = (x8_mm){0};
    for (x8_modem_slot slot = X8_MODEM_SLOT_EXTERNAL;
         slot < X8_MODEM_SLOT_COUNT;
         slot++) {
        mm->slots[slot].bearer_status.slot = slot;
    }
}

void x8_mm_clear(x8_mm *mm)
{
    if (mm == NULL) {
        return;
    }

    g_clear_object(&mm->manager);
    mm->logged_manager = false;
    for (x8_modem_slot slot = X8_MODEM_SLOT_EXTERNAL;
         slot < X8_MODEM_SLOT_COUNT;
         slot++) {
        clear_slot_state(&mm->slots[slot]);
        mm->slots[slot].bearer_status.slot = slot;
    }
}

bool x8_mm_ensure_modems(x8_mm *mm,
                         const x8_cellular_config *config,
                         GError **error)
{
    bool enabled_slots[X8_MODEM_SLOT_COUNT] = {0};
    bool ensured_slots[X8_MODEM_SLOT_COUNT] = {0};
    bool held_slots[X8_MODEM_SLOT_COUNT] = {0};
    bool any_enabled_modem = false;

    if (mm == NULL || config == NULL) {
        g_set_error_literal(error,
                            x8_mm_error_quark(),
                            EINVAL,
                            "invalid ModemManager ensure arguments");
        return false;
    }

    for (x8_modem_slot slot = X8_MODEM_SLOT_EXTERNAL;
         slot < X8_MODEM_SLOT_COUNT;
         slot++) {
        clear_slot_state(&mm->slots[slot]);
        mm->slots[slot].bearer_status.slot = slot;
    }

    for (x8_modem_slot slot = X8_MODEM_SLOT_EXTERNAL;
         slot < X8_MODEM_SLOT_COUNT;
         slot++) {
        const x8_modem_config *modem =
            x8_cellular_config_get_modem(config, slot);

        if (modem != NULL && modem->enabled) {
            enabled_slots[slot] = true;
            any_enabled_modem = true;
        }
    }

    if (!any_enabled_modem) {
        g_set_error_literal(error,
                            x8_mm_error_quark(),
                            EINVAL,
                            "no modem enabled by APN parameters");
        return false;
    }

    for (unsigned int attempt = 1; attempt <= X8_MM_MAX_ATTEMPTS; attempt++) {
        g_autoptr(GError) connect_error = NULL;
        GList *objects = NULL;
        bool any_pending = false;

        for (x8_modem_slot slot = X8_MODEM_SLOT_EXTERNAL;
             slot < X8_MODEM_SLOT_COUNT;
             slot++) {
            if (enabled_slots[slot] && !ensured_slots[slot] &&
                !held_slots[slot]) {
                any_pending = true;
                break;
            }
        }

        if (!any_pending) {
            break;
        }

        if (!mm_connect(mm, &connect_error)) {
            g_warning("modemmanager: attempt %u/%u failed: %s",
                      attempt,
                      X8_MM_MAX_ATTEMPTS,
                      connect_error != NULL ? connect_error->message
                                            : "unknown error");
        } else {
            objects = mm_get_objects(mm);
            g_message("modemmanager: attempt %u/%u found %u object(s)",
                      attempt,
                      X8_MM_MAX_ATTEMPTS,
                      g_list_length(objects));
            log_mm_objects(objects);

            for (x8_modem_slot slot = X8_MODEM_SLOT_EXTERNAL;
                 slot < X8_MODEM_SLOT_COUNT;
                 slot++) {
                const x8_modem_config *modem = NULL;
                g_autoptr(GError) slot_error = NULL;
                x8_mm_slot_result result;

                modem = x8_cellular_config_get_modem(config, slot);
                if (modem == NULL || !enabled_slots[slot] ||
                    ensured_slots[slot] || held_slots[slot]) {
                    continue;
                }

                result = ensure_one_modem_attempt(mm,
                                                  objects,
                                                  modem,
                                                  &slot_error);
                if (result == X8_MM_SLOT_RESULT_ENSURED) {
                    ensured_slots[slot] = true;
                    continue;
                }

                if (result == X8_MM_SLOT_RESULT_PENDING) {
                    continue;
                }

                if (result == X8_MM_SLOT_RESULT_HELD) {
                    held_slots[slot] = true;
                    g_warning("modemmanager: slot %s held: %s",
                              modem != NULL ? modem->name
                                            : x8_modem_slot_name(slot),
                              slot_error != NULL ? slot_error->message
                                                 : "unknown error");
                    continue;
                }

                g_warning("modemmanager: slot %s attempt %u/%u failed: %s",
                          modem != NULL ? modem->name
                                        : x8_modem_slot_name(slot),
                          attempt,
                          X8_MM_MAX_ATTEMPTS,
                          slot_error != NULL ? slot_error->message
                                             : "unknown error");
            }
        }

        g_list_free_full(objects, g_object_unref);

        if (attempt < X8_MM_MAX_ATTEMPTS) {
            g_usleep(X8_MM_RETRY_USEC);
        }
    }

    for (x8_modem_slot slot = X8_MODEM_SLOT_EXTERNAL;
         slot < X8_MODEM_SLOT_COUNT;
         slot++) {
        if (enabled_slots[slot] && ensured_slots[slot]) {
            return true;
        }
    }

    bool any_held = false;
    bool any_retryable = false;
    for (x8_modem_slot slot = X8_MODEM_SLOT_EXTERNAL;
         slot < X8_MODEM_SLOT_COUNT;
         slot++) {
        if (!enabled_slots[slot] || ensured_slots[slot]) {
            continue;
        }
        if (held_slots[slot]) {
            any_held = true;
        } else {
            any_retryable = true;
        }
    }

    if (any_held && !any_retryable) {
        g_warning("modemmanager: no enabled modem connected; all remaining enabled modem faults are held");
        return true;
    }

    g_set_error(error,
                x8_mm_error_quark(),
                ENODEV,
                "no enabled modem ensured by ModemManager after %u attempts",
                X8_MM_MAX_ATTEMPTS);
    return false;
}

const x8_mm_bearer_status *x8_mm_get_bearer_status(const x8_mm *mm,
                                                    x8_modem_slot slot)
{
    if (mm == NULL || !slot_is_valid(slot)) {
        return NULL;
    }

    return &mm->slots[slot].bearer_status;
}

bool x8_mm_disconnect_bearer(x8_mm *mm,
                             x8_modem_slot slot,
                             GError **error)
{
    x8_mm_slot_state *state = NULL;

    if (mm == NULL || !slot_is_valid(slot)) {
        g_set_error_literal(error,
                            x8_mm_error_quark(),
                            EINVAL,
                            "invalid bearer disconnect arguments");
        return false;
    }

    state = &mm->slots[slot];
    if (state->bearer == NULL || !state->bearer_status.connected) {
        g_set_error(error,
                    x8_mm_error_quark(),
                    ENOENT,
                    "slot %s has no connected bearer to disconnect",
                    x8_modem_slot_name(slot));
        return false;
    }

    g_message("modemmanager: slot %s disconnecting bearer %s for reconnect",
              x8_modem_slot_name(slot),
              display_string(state->bearer_status.bearer_path));
    if (!mm_bearer_disconnect_sync(state->bearer, NULL, error)) {
        g_prefix_error(error,
                       "slot %s bearer %s disconnect failed: ",
                       x8_modem_slot_name(slot),
                       display_string(state->bearer_status.bearer_path));
        return false;
    }

    clear_slot_state(state);
    state->bearer_status.slot = slot;
    return true;
}

bool x8_mm_disconnect_and_disable_modem(x8_mm *mm,
                                        const x8_cellular_config *config,
                                        x8_modem_slot slot,
                                        GError **error)
{
    const x8_modem_config *modem_config = NULL;
    GList *objects = NULL;
    g_autoptr(MMObject) object = NULL;
    g_autoptr(MMModem) modem = NULL;
    MMModemState state;

    if (mm == NULL || config == NULL || !slot_is_valid(slot)) {
        g_set_error_literal(error,
                            x8_mm_error_quark(),
                            EINVAL,
                            "invalid modem disconnect/disable arguments");
        return false;
    }

    modem_config = x8_cellular_config_get_modem(config, slot);
    if (modem_config == NULL) {
        g_set_error(error,
                    x8_mm_error_quark(),
                    EINVAL,
                    "slot %s has no modem config",
                    x8_modem_slot_name(slot));
        return false;
    }

    if (mm->slots[slot].bearer_status.connected) {
        if (!x8_mm_disconnect_bearer(mm, slot, error)) {
            return false;
        }
    } else {
        g_message("modemmanager: slot %s has no connected bearer before modem disable",
                  modem_config->name);
    }

    if (mm->manager == NULL && !mm_connect(mm, error)) {
        return false;
    }

    objects = mm_get_objects(mm);
    object = find_matching_object(objects, modem_config);
    g_list_free_full(objects, g_object_unref);
    if (object == NULL) {
        g_set_error(error,
                    x8_mm_error_quark(),
                    ENOENT,
                    "slot %s [%s] %s is not listed by ModemManager for disable",
                    modem_config->name,
                    modem_config->match.manufacturer,
                    modem_config->match.model);
        return false;
    }

    modem = mm_object_get_modem(object);
    if (modem == NULL) {
        g_set_error(error,
                    x8_mm_error_quark(),
                    ENOENT,
                    "slot %s matched object has no modem interface for disable",
                    modem_config->name);
        return false;
    }

    state = mm_modem_get_state(modem);
    if (state < MM_MODEM_STATE_ENABLED) {
        g_message("modemmanager: slot %s matched %s already %s after bearer disconnect",
                  modem_config->name,
                  display_string(mm_modem_get_path(modem)),
                  modem_state_name(state));
        return true;
    }

    g_message("modemmanager: slot %s disabling modem %s after failed data path",
              modem_config->name,
              display_string(mm_modem_get_path(modem)));
    if (!mm_modem_disable_sync(modem, NULL, error)) {
        g_prefix_error(error,
                       "slot %s modem %s disable failed: ",
                       modem_config->name,
                       display_string(mm_modem_get_path(modem)));
        return false;
    }

    g_message("modemmanager: slot %s modem disable requested; next supervisor cycle will enable/connect",
              modem_config->name);
    return true;
}
