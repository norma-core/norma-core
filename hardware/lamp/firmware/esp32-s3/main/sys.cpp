#include "sys.h"
#include "driver/temperature_sensor.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_system.h"
#include "esp_timer.h"

static const char* TAG = "sys";
static temperature_sensor_handle_t tsens = nullptr;
static RTC_NOINIT_ATTR uint32_t crumbMagic;
static RTC_NOINIT_ATTR int crumbStage;
static RTC_NOINIT_ATTR int crumbNote;
static int prevStage = -1, prevNote = -1;
static const uint32_t MAGIC = 0x6c616d70;   // "lamp"

namespace sys {

void begin() {
    prevStage = crumbMagic == MAGIC ? crumbStage : -1;   // -1: cold start or the breadcrumb was never written
    prevNote = crumbMagic == MAGIC ? crumbNote : -1;
    crumbMagic = MAGIC;
    crumbStage = 0;
    crumbNote = 0;
    ESP_LOGI(TAG, "reset reason %s, previous boot reached stage %d, detector %d", resetReason(), prevStage, prevNote);
    // The driver picks the sensor range that covers these bounds: 20..85 gives the 20..100 C range (+-2 C). The old
    // -10..80 (+-1 C) was left behind by the closed head, which runs at 83..84 C with the model on (2026-11-01).
    temperature_sensor_config_t cfg = TEMPERATURE_SENSOR_CONFIG_DEFAULT(20, 85);
    if (temperature_sensor_install(&cfg, &tsens) == ESP_OK && temperature_sensor_enable(tsens) == ESP_OK) {
        float t = 0;
        temperature_sensor_get_celsius(tsens, &t);
        ESP_LOGI(TAG, "chip temperature %.1f C", t);
    } else {
        ESP_LOGW(TAG, "temperature sensor not available");
        tsens = nullptr;
    }
}

bool temperature(float* c) {
    if (!tsens) return false;
    return temperature_sensor_get_celsius(tsens, c) == ESP_OK;
}

void stage(int n) { crumbStage = n; }
int lastStage() { return prevStage; }
void note(int n) { crumbNote = n; }
int lastNote() { return prevNote; }
const char* resetReason() {
    switch (esp_reset_reason()) {
        case ESP_RST_POWERON: return "power on";
        case ESP_RST_SW: return "software restart";
        case ESP_RST_PANIC: return "PANIC";
        case ESP_RST_INT_WDT: return "INTERRUPT WATCHDOG";
        case ESP_RST_TASK_WDT: return "TASK WATCHDOG";
        case ESP_RST_WDT: return "WATCHDOG";
        case ESP_RST_BROWNOUT: return "BROWNOUT";
        case ESP_RST_DEEPSLEEP: return "deep sleep";
        case ESP_RST_EXT: return "external pin";
        case ESP_RST_USB: return "usb";
        case ESP_RST_JTAG: return "jtag";
        default: return "unknown";
    }
}
uint32_t uptimeS() { return (uint32_t)(esp_timer_get_time() / 1000000LL); }
uint32_t freeHeap() { return heap_caps_get_free_size(MALLOC_CAP_INTERNAL); }
uint32_t largestDmaBlock() { return heap_caps_get_largest_free_block(MALLOC_CAP_DMA); }
uint32_t freePsram() { return heap_caps_get_free_size(MALLOC_CAP_SPIRAM); }
uint32_t totalPsram() { return heap_caps_get_total_size(MALLOC_CAP_SPIRAM); }

}  // namespace sys
