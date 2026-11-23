#include "net.h"
#include "config.h"
#include <cstring>
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "mdns.h"

static const char* TAG = "net";
static EventGroupHandle_t events;
static const int GOT_IP = BIT0;
static bool apMode = false;
static esp_netif_t* staNetif = nullptr;
static esp_netif_t* apNetif = nullptr;
static char ipStr[20] = "0.0.0.0";

static void onEvent(void*, esp_event_base_t base, int32_t id, void* data) {
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        if (!apMode) {
            xEventGroupClearBits(events, GOT_IP);
            vTaskDelay(pdMS_TO_TICKS(500));
            esp_wifi_connect();
        }
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        auto* e = (ip_event_got_ip_t*)data;
        snprintf(ipStr, sizeof ipStr, IPSTR, IP2STR(&e->ip_info.ip));
        ESP_LOGI(TAG, "station address %s", ipStr);
        xEventGroupSetBits(events, GOT_IP);
    }
}

// Access point mode is a fall-back, not a place to stay: after a power cut the router comes back slower than the lamp,
// which then sat on its own AP until somebody rebooted it (0.29). Every WIFI_AP_RESTART_MS: nobody connected -> reboot
// and try the home network again. A phone on the AP keeps it up.
static void apWatch(void*) {
    wifi_sta_list_t sta = {};
    if (esp_wifi_ap_get_sta_list(&sta) == ESP_OK && sta.num > 0) {
        ESP_LOGI(TAG, "access point: %d client(s), staying", sta.num);
        return;
    }
    ESP_LOGW(TAG, "access point: nobody connected for %d s, rebooting to look for %s again", WIFI_AP_RESTART_MS / 1000, WIFI_STA_SSID);
    esp_restart();
}

static void startMdns() {
    if (mdns_init() != ESP_OK) return;
    mdns_hostname_set(MDNS_NAME);
    mdns_instance_name_set("NC lamp");
    mdns_txt_item_t txt[] = {{"mcp", "/mcp"}};                      // the MCP endpoint, for clients that browse
    mdns_service_add(nullptr, "_http", "_tcp", WEB_PORT, txt, 1);
    ESP_LOGI(TAG, "http://%s.local", MDNS_NAME);
}

namespace net {

void begin() {
    events = xEventGroupCreate();
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    staNetif = esp_netif_create_default_wifi_sta();
    esp_netif_set_hostname(staNetif, WIFI_HOSTNAME);     // before esp_wifi_start, so the DHCP request carries it (0.31)
    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &onEvent, nullptr));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &onEvent, nullptr));

    wifi_config_t wc = {};
    strncpy((char*)wc.sta.ssid, WIFI_STA_SSID, sizeof wc.sta.ssid - 1);
    strncpy((char*)wc.sta.password, WIFI_STA_PASS, sizeof wc.sta.password - 1);
    wc.sta.threshold.authmode = strlen(WIFI_STA_PASS) ? WIFI_AUTH_WPA2_PSK : WIFI_AUTH_OPEN;
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wc));
    ESP_ERROR_CHECK(esp_wifi_start());
    esp_wifi_set_ps(WIFI_PS_NONE);   // the MJPEG stream wants the radio awake

    ESP_LOGI(TAG, "joining %s ...", WIFI_STA_SSID);
    EventBits_t bits = xEventGroupWaitBits(events, GOT_IP, pdFALSE, pdTRUE, pdMS_TO_TICKS(WIFI_STA_TIMEOUT_MS));
    if (!(bits & GOT_IP)) {
        ESP_LOGW(TAG, "no station address in %d ms, opening the access point %s", WIFI_STA_TIMEOUT_MS, WIFI_AP_SSID);
        apMode = true;
        ESP_ERROR_CHECK(esp_wifi_stop());
        apNetif = esp_netif_create_default_wifi_ap();
        wifi_config_t ac = {};
        strncpy((char*)ac.ap.ssid, WIFI_AP_SSID, sizeof ac.ap.ssid - 1);
        ac.ap.ssid_len = strlen(WIFI_AP_SSID);
        strncpy((char*)ac.ap.password, WIFI_AP_PASS, sizeof ac.ap.password - 1);
        ac.ap.max_connection = 4;
        ac.ap.authmode = strlen(WIFI_AP_PASS) >= 8 ? WIFI_AUTH_WPA2_PSK : WIFI_AUTH_OPEN;
        ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_AP));
        ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &ac));
        ESP_ERROR_CHECK(esp_wifi_start());
        esp_netif_ip_info_t info;
        esp_netif_get_ip_info(apNetif, &info);
        snprintf(ipStr, sizeof ipStr, IPSTR, IP2STR(&info.ip));
        ESP_LOGI(TAG, "access point up at %s, reboot in %d s if nobody connects", ipStr, WIFI_AP_RESTART_MS / 1000);
        const esp_timer_create_args_t ta = {.callback = apWatch, .arg = nullptr, .dispatch_method = ESP_TIMER_TASK,
                                            .name = "ap_watch", .skip_unhandled_events = true};
        esp_timer_handle_t t;
        if (esp_timer_create(&ta, &t) == ESP_OK) esp_timer_start_periodic(t, (uint64_t)WIFI_AP_RESTART_MS * 1000);
    }
    startMdns();
}

bool isAp() { return apMode; }
std::string ip() { return ipStr; }
std::string ssid() { return apMode ? WIFI_AP_SSID : WIFI_STA_SSID; }
int rssi() {
    if (apMode) return 0;
    wifi_ap_record_t ap;
    return esp_wifi_sta_get_ap_info(&ap) == ESP_OK ? ap.rssi : 0;
}

}  // namespace net
