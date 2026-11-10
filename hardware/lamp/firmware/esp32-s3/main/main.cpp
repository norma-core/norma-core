// NC lamp head: XIAO ESP32-S3 with the WS2812 ring (light.cpp), the 5 ST3215 servos (servo.cpp), a web page, a REST
// API, an MCP server for AI clients (mcp.cpp) and OTA updates. With the Sense camera module (CAM_ENABLED 1): YOLO11n
// (ESP-DL coco_detect) on the camera picture, a live stream with the boxes drawn over it, and the fruit search.
#include "camera.h"
#include "config.h"
#include "detector.h"
#include "esp_log.h"
#include "esp_netif_sntp.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "light.h"
#include "net.h"
#include "nvs_flash.h"
#include "ota.h"
#include "search.h"
#include "servo.h"
#include "sys.h"
#include "web.h"
#include <cstdlib>

static const char* TAG = "main";

extern "C" void app_main(void) {
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ESP_ERROR_CHECK(nvs_flash_init());
    }
    ESP_LOGI(TAG, "firmware %s in slot %s%s", ota::version(), ota::runningSlot(),
             ota::pendingVerify() ? " (first boot after an update)" : "");
    setenv("TZ", CLOCK_TZ, 1);
    tzset();
    sys::begin();
    sys::stage(1);
    net::begin();                           // first: Wi-Fi start and the mDNS announce are the internal-RAM peak (0.5 ran out with the ring and the bus before them)
    if (!net::isAp()) {                     // clock from the internet for the clock effect
        esp_sntp_config_t sc = ESP_NETIF_SNTP_DEFAULT_CONFIG(NTP_SERVER);
        esp_netif_sntp_init(&sc);
    }
    sys::stage(2);
    bool lightOk = light::begin();          // the idle look from flash (random: one of them)
    if (ota::rolledBack()) {                // the new firmware crashed at its first start, this is the old one again
        ESP_LOGE(TAG, "ROLLED BACK: the new firmware crashed at stage %d (%s), running %s again", sys::lastStage(), sys::resetReason(), ota::version());
        light::flash(light::RED, 3);
    }
    sys::stage(3);
    bool servoOk = servo::begin();          // reads the servos, never moves them
    vTaskDelay(pdMS_TO_TICKS(1500));        // let mDNS finish announcing before the camera takes its 30 kB of DMA RAM (0.6: one alloc error there)
    sys::stage(4);
    bool camOk = cam::begin();              // CAM_ON_AT_BOOT 0: only the lock, the sensor starts with the search or the page's Camera button
    sys::stage(5);
    web::begin();                           // the page works even without a camera (status, temperature)
    sys::stage(6);
    bool detOk = det::begin();              // the task loads the model 2 s later and waits for the camera and DET_ON_AT_BOOT / the search
    sys::stage(7);
    search::begin();                        // off until /api/search {"on":true} or the page button
    sys::stage(8);
#if OTA_TEST_CRASH
    ESP_LOGE(TAG, "OTA_TEST_CRASH: aborting on purpose before the firmware is confirmed");
    vTaskDelay(pdMS_TO_TICKS(300));
    abort();
#endif
    ESP_LOGI(TAG, "ready: http://%s  camera %s  detector %s  light %s  servos %s", net::ip().c_str(),
             !cam::present() ? "none (CAM_ENABLED 0)" : !camOk ? "FAILED" : cam::ok() ? "ok" : "off until needed",
             !cam::present() ? "none" : !detOk ? "NO TASK" : det::enabled() ? "on" : "loading, off",
             lightOk ? "ok" : "FAILED", servoOk ? "ok" : "NONE FOUND");
    if (ota::pendingVerify()) {             // everything above came up without a crash: keep this firmware ...
        // ... once the model has loaded too: it loads 2 s after boot on the detector task, and that load is the one boot
        // crash seen so far (0.29 confirmed the firmware before it, so the bootloader could never have rolled it back)
        int64_t t0 = esp_timer_get_time();
        while (detOk && !det::loadFinished() && esp_timer_get_time() - t0 < (int64_t)OTA_VERIFY_WAIT_MS * 1000) vTaskDelay(pdMS_TO_TICKS(100));
        ota::markValid();
        light::flash(light::GREEN, 2);      // the new firmware is in: green twice
        ESP_LOGI(TAG, "new firmware confirmed after %d ms (model %s), no rollback", (int)((esp_timer_get_time() - t0) / 1000),
                 det::modelOk() ? "loaded" : det::loadFinished() ? "FAILED to load" : "still loading");
    }

    sys::stage(9);                          // running
    while (true) {
        vTaskDelay(pdMS_TO_TICKS(10000));
        float t = 0;
        sys::temperature(&t);
        det::Result r = det::latest();
        ESP_LOGI(TAG, "up %us  %.1f C  heap %u kB  psram %u kB  cam %.1f fps  yolo %.2f fps %d ms %d boxes  torque %s  light %s",
                 (unsigned)sys::uptimeS(), t, (unsigned)(sys::freeHeap() / 1024), (unsigned)(sys::freePsram() / 1024),
                 cam::fps(), det::fps(), r.inferMs, (int)r.boxes.size(), servo::torque() ? "on" : "off", light::modeName(light::get().mode));
    }
}
