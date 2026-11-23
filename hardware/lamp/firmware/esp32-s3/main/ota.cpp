#include "ota.h"
#include "detector.h"
#include "light.h"
#include "search.h"
#include "sys.h"
#include <algorithm>
#include <cstdlib>
#include <cstring>
#include "cJSON.h"
#include "esp_app_desc.h"
#include "esp_log.h"
#include "esp_ota_ops.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "nvs.h"

static const char* TAG = "ota";
static bool sBusy = false;
static bool prevDet = true;                    // detector state from before the upload, back after a failure
static int sPercent = -1;
static light::Mode prevMode = light::AURORA;   // the ring look from before the upload, back after a failure

static void restartCb(void*) { esp_restart(); }

static esp_err_t fail(httpd_req_t* req, httpd_err_code_t code, const char* msg) {
    ESP_LOGE(TAG, "%s", msg);
    sBusy = false;
    sPercent = -1;
    det::setEnabled(prevDet);
    light::setMode(light::modeName(prevMode));
    light::flash(light::RED, 2);
    return httpd_resp_send_err(req, code, msg);
}

namespace ota {

const char* version() { return esp_app_get_description()->version; }
const char* runningSlot() { return esp_ota_get_running_partition()->label; }

bool pendingVerify() {
    esp_ota_img_states_t st;
    if (esp_ota_get_state_partition(esp_ota_get_running_partition(), &st) != ESP_OK) return false;
    return st == ESP_OTA_IMG_PENDING_VERIFY;
}

// "An uploaded app has not made a confirmed boot yet": set when the image is written, cleared when the new app is
// confirmed or when the fall-back is reported. Without it every later boot crash of the old app would look like a
// rollback, because the bootloader leaves the other slot marked "aborted" until the next upload.
static void setPending(bool v) {
    nvs_handle_t h;
    if (nvs_open("lamp", NVS_READWRITE, &h) == ESP_OK) { nvs_set_u8(h, "otaPend", v ? 1 : 0); nvs_commit(h); nvs_close(h); }
}
static bool pending() {
    nvs_handle_t h;
    uint8_t v = 0;
    if (nvs_open("lamp", NVS_READONLY, &h) == ESP_OK) { nvs_get_u8(h, "otaPend", &v); nvs_close(h); }
    return v == 1;
}
void markValid() { esp_ota_mark_app_valid_cancel_rollback(); setPending(false); }
bool busy() { return sBusy; }
// The bootloader boots the previous app when the new one crashes before markValid(): then the other slot is marked
// "aborted" by the bootloader, an upload is pending (see above), the reset came from a crash and the breadcrumb says
// the last boot died in the start-up stages (1..8, 8 = just before markValid). A normal boot leaves the breadcrumb at 9.
bool rolledBack() {
    static int cached = -1;
    if (cached < 0) {
        int ls = sys::lastStage();
        esp_reset_reason_t r = esp_reset_reason();
        bool crash = r == ESP_RST_PANIC || r == ESP_RST_INT_WDT || r == ESP_RST_TASK_WDT || r == ESP_RST_WDT;
        const esp_partition_t* other = esp_ota_get_next_update_partition(nullptr);
        esp_ota_img_states_t st = ESP_OTA_IMG_UNDEFINED;
        bool aborted = other && esp_ota_get_state_partition(other, &st) == ESP_OK && (st == ESP_OTA_IMG_ABORTED || st == ESP_OTA_IMG_INVALID);
        cached = (aborted && crash && pending() && ls >= 1 && ls <= 8) ? 1 : 0;
        if (cached) setPending(false);      // reported once
    }
    return cached == 1;
}
int progressPercent() { return sPercent; }

esp_err_t handleUpdate(httpd_req_t* req) {
    if (sBusy) return httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "an update is already running");
    const esp_partition_t* part = esp_ota_get_next_update_partition(nullptr);
    if (!part) return httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "no free app slot");
    size_t len = req->content_len;
    if (len < 256 * 1024 || len > part->size) {
        ESP_LOGE(TAG, "refused: %u bytes, slot %s holds %u", (unsigned)len, part->label, (unsigned)part->size);
        return httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "body is not an app image of a sensible size");
    }
    sBusy = true;
    sPercent = 0;
    prevMode = light::get().mode;            // the ring is the progress bar while the image arrives
    light::setProgress(0);
    light::setMode("update");
    search::setOn(false);            // it would keep moving the head and repainting the ring while the image is written (0.30)
    prevDet = det::enabled();
    det::setEnabled(false);          // the model task would fight the flash writes for the CPU
    vTaskDelay(pdMS_TO_TICKS(200));
    ESP_LOGI(TAG, "writing %u bytes to %s", (unsigned)len, part->label);

    esp_ota_handle_t h;
    esp_err_t e = esp_ota_begin(part, len, &h);
    if (e != ESP_OK) return fail(req, HTTPD_500_INTERNAL_SERVER_ERROR, "esp_ota_begin failed");
    const size_t CH = 8192;
    char* buf = (char*)malloc(CH);
    if (!buf) {
        esp_ota_abort(h);
        return fail(req, HTTPD_500_INTERNAL_SERVER_ERROR, "no memory");
    }
    size_t got = 0;
    int idle = 0;
    while (got < len) {
        int r = httpd_req_recv(req, buf, std::min(CH, len - got));
        if (r == HTTPD_SOCK_ERR_TIMEOUT) {
            if (++idle > 6) break;   // 6 x the socket timeout without a byte: give up
            continue;
        }
        if (r <= 0) break;
        idle = 0;
        if (esp_ota_write(h, buf, r) != ESP_OK) break;
        got += r;
        sPercent = (int)(got * 100 / len);
        light::setProgress((float)got / len);
    }
    free(buf);
    if (got != len) {
        esp_ota_abort(h);
        return fail(req, HTTPD_500_INTERNAL_SERVER_ERROR, "upload stopped early");
    }
    e = esp_ota_end(h);
    if (e != ESP_OK)
        return fail(req, HTTPD_400_BAD_REQUEST,
                    e == ESP_ERR_OTA_VALIDATE_FAILED ? "image not valid (not an ESP32-S3 app?)" : "esp_ota_end failed");
    if (esp_ota_set_boot_partition(part) != ESP_OK)
        return fail(req, HTTPD_500_INTERNAL_SERVER_ERROR, "could not set the boot slot");
    setPending(true);

    esp_app_desc_t desc = {};
    esp_ota_get_partition_description(part, &desc);
    ESP_LOGI(TAG, "ok: version %s in %s, rebooting", desc.version, part->label);
    cJSON* o = cJSON_CreateObject();
    cJSON_AddBoolToObject(o, "ok", true);
    cJSON_AddNumberToObject(o, "bytes", (double)got);
    cJSON_AddStringToObject(o, "slot", part->label);
    cJSON_AddStringToObject(o, "version", desc.version);
    cJSON_AddBoolToObject(o, "reboot", true);
    char* s = cJSON_PrintUnformatted(o);
    cJSON_Delete(o);
    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    httpd_resp_send(req, s, HTTPD_RESP_USE_STRLEN);
    free(s);
    sPercent = 100;
    light::setProgress(1);
    light::flash(light::GREEN, 2);          // written and checked: green twice, then the reboot

    const esp_timer_create_args_t a = {.callback = restartCb, .arg = nullptr, .dispatch_method = ESP_TIMER_TASK,
                                       .name = "ota_restart", .skip_unhandled_events = false};
    esp_timer_handle_t t;
    esp_timer_create(&a, &t);
    esp_timer_start_once(t, 1500 * 1000);   // let the answer leave first
    return ESP_OK;
}

}  // namespace ota
