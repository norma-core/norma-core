#include "camera.h"
#include "config.h"
#include <cstring>
#include "esp_camera.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "img_converters.h"

static const char* TAG = "cam";
static bool camOk = false;
static char lastErr[80] = "";             // why the last start failed (shown in /api/status as cam.err), empty after a good start
static int camW = 0, camH = 0;
static bool hf = CAM_HFLIP, vf = CAM_VFLIP;
static int ael = CAM_AE_LEVEL;
static SemaphoreHandle_t lock;
static uint32_t frames = 0;
static int64_t fpsT0 = 0;
static float fpsVal = 0;

static void countFrame() {
    frames++;
    int64_t now = esp_timer_get_time();
    if (fpsT0 == 0) fpsT0 = now;
    if (now - fpsT0 >= 2000000) {
        fpsVal = frames * 1000000.0f / (now - fpsT0);
        frames = 0;
        fpsT0 = now;
    }
}

namespace cam {

bool present() { return CAM_ENABLED != 0; }

bool begin() {
    lock = xSemaphoreCreateMutex();
    if (!present()) {
        snprintf(lastErr, sizeof lastErr, "no camera module on this lamp (CAM_ENABLED 0)");
        ESP_LOGI(TAG, "no camera module (CAM_ENABLED 0)");
        return true;
    }
    if (!CAM_ON_AT_BOOT) {
        ESP_LOGI(TAG, "camera off at boot (CAM_ON_AT_BOOT 0)");
        return true;
    }
    return start();
}

bool start() {
    if (camOk) return true;
    if (!present()) return false;            // lastErr says why since begin()
    xSemaphoreTake(lock, portMAX_DELAY);
    camera_config_t c = {};
    c.pin_pwdn = CAM_PIN_PWDN;
    c.pin_reset = CAM_PIN_RESET;
    c.pin_xclk = CAM_PIN_XCLK;
    c.pin_sccb_sda = CAM_PIN_SIOD;
    c.pin_sccb_scl = CAM_PIN_SIOC;
    c.pin_d7 = CAM_PIN_D7;
    c.pin_d6 = CAM_PIN_D6;
    c.pin_d5 = CAM_PIN_D5;
    c.pin_d4 = CAM_PIN_D4;
    c.pin_d3 = CAM_PIN_D3;
    c.pin_d2 = CAM_PIN_D2;
    c.pin_d1 = CAM_PIN_D1;
    c.pin_d0 = CAM_PIN_D0;
    c.pin_vsync = CAM_PIN_VSYNC;
    c.pin_href = CAM_PIN_HREF;
    c.pin_pclk = CAM_PIN_PCLK;
    c.xclk_freq_hz = CAM_XCLK_HZ;
    c.ledc_timer = LEDC_TIMER_0;
    c.ledc_channel = LEDC_CHANNEL_0;
    c.pixel_format = PIXFORMAT_RGB565;
    c.frame_size = CAM_FRAMESIZE;
    c.jpeg_quality = 12;                 // unused in RGB565
    c.fb_count = 2;
    c.fb_location = CAMERA_FB_IN_PSRAM;
    c.grab_mode = CAMERA_GRAB_LATEST;

    esp_err_t err = esp_camera_init(&c);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "camera init failed: %s", esp_err_to_name(err));
        snprintf(lastErr, sizeof lastErr, "%s (largest free DMA block %u kB)", esp_err_to_name(err),
                 (unsigned)(heap_caps_get_largest_free_block(MALLOC_CAP_DMA) / 1024));
        xSemaphoreGive(lock);
        return false;
    }
    sensor_t* s = esp_camera_sensor_get();
    if (s) {
        s->set_hmirror(s, hf);
        s->set_vflip(s, vf);
        s->set_ae_level(s, ael);
    }
    // one frame to learn the size
    camera_fb_t* fb = esp_camera_fb_get();
    if (!fb) {
        ESP_LOGE(TAG, "no first frame");
        snprintf(lastErr, sizeof lastErr, "no first frame");
        esp_camera_deinit();
        xSemaphoreGive(lock);
        return false;
    }
    camW = fb->width;
    camH = fb->height;
    esp_camera_fb_return(fb);
    camOk = true;
    lastErr[0] = 0;
    xSemaphoreGive(lock);
    ESP_LOGI(TAG, "camera %d x %d RGB565, %d kB a frame", camW, camH, (int)(frameBytes() / 1024));
    return true;
}

void stop() {
    if (!camOk) return;
    xSemaphoreTake(lock, portMAX_DELAY);     // nobody holds a frame now
    camOk = false;
    esp_err_t err = esp_camera_deinit();
    xSemaphoreGive(lock);
    fpsVal = 0; frames = 0; fpsT0 = 0;
    ESP_LOGI(TAG, "camera stopped%s", err == ESP_OK ? "" : " (deinit error)");
}
bool ok() { return camOk; }
const char* lastError() { return lastErr; }
int width() { return camW; }
int height() { return camH; }
size_t frameBytes() { return (size_t)camW * camH * 2; }

bool copyFrame(uint8_t* dst, int64_t* ts) {
    if (!camOk) return false;
    xSemaphoreTake(lock, portMAX_DELAY);
    camera_fb_t* fb = esp_camera_fb_get();
    bool good = fb && fb->len == frameBytes();
    if (good) {
        memcpy(dst, fb->buf, fb->len);
        if (ts) *ts = esp_timer_get_time();
        countFrame();
    }
    if (fb) esp_camera_fb_return(fb);
    xSemaphoreGive(lock);
    return good;
}

bool jpeg(uint8_t** out, size_t* len) {
    if (!camOk) return false;
    xSemaphoreTake(lock, portMAX_DELAY);
    camera_fb_t* fb = esp_camera_fb_get();
    bool good = false;
    if (fb) {
        good = frame2jpg(fb, CAM_JPEG_Q, out, len);
        esp_camera_fb_return(fb);
        if (good) countFrame();
    }
    xSemaphoreGive(lock);
    return good;
}

bool encodeRgb565(const uint8_t* rgb565, int w, int h, uint8_t** out, size_t* len) {
    return fmt2jpg((uint8_t*)rgb565, (size_t)w * h * 2, w, h, PIXFORMAT_RGB565, CAM_JPEG_Q, out, len);
}

void setFlip(bool h, bool v) {
    hf = h;
    vf = v;
    sensor_t* s = esp_camera_sensor_get();
    if (s) {
        s->set_hmirror(s, hf);
        s->set_vflip(s, vf);
    }
}
bool hflip() { return hf; }
bool vflip() { return vf; }
void setAeLevel(int level) {
    ael = level < -2 ? -2 : level > 2 ? 2 : level;
    sensor_t* s = esp_camera_sensor_get();
    if (s) s->set_ae_level(s, ael);
}
int aeLevel() { return ael; }
float fps() { return fpsVal; }

}  // namespace cam
