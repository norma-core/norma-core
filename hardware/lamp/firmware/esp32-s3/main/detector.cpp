#include "detector.h"
#include "camera.h"
#include "coco_detect.hpp"
#include "coco_names.h"
#include "config.h"
#include <cstring>
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "sys.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

static const char* TAG = "det";
static COCODetect* model = nullptr;
static bool mOk = false;
static volatile bool loadDone = false;   // the constructor has returned (or thrown us out): the risky part of the boot is over
static volatile bool on = DET_ON_AT_BOOT;
static volatile bool be = CAM_RGB565_BIG_ENDIAN;
static float thr = DET_SCORE_THR;
static volatile bool thrDirty = false;
static SemaphoreHandle_t lock;
static det::Result last;
static uint8_t* frame = nullptr;       // RGB565 copy the model works on (PSRAM)
static uint8_t* jpg = nullptr;         // last analysed frame, boxes drawn, as JPEG (PSRAM)
static size_t jpgLen = 0;
static float fpsVal = 0;

// Box colours as RGB565 (one per class slot, repeating): orange, green, cyan, magenta, yellow, red
static const uint16_t COLORS[] = {0xFC00, 0x07E0, 0x07FF, 0xF81F, 0xFFE0, 0xF800};

static void putPixel(uint8_t* img, int w, int h, int x, int y, uint16_t c) {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    uint8_t* p = img + ((size_t)y * w + x) * 2;
    if (be) { p[0] = c >> 8; p[1] = c & 0xFF; } else { p[0] = c & 0xFF; p[1] = c >> 8; }
}

static void drawBox(uint8_t* img, int w, int h, const det::Box& b) {
    uint16_t c = COLORS[b.cls % (sizeof COLORS / sizeof COLORS[0])];
    for (int t = 0; t < 2; t++) {   // two pixels thick
        for (int x = b.x0; x <= b.x1; x++) { putPixel(img, w, h, x, b.y0 + t, c); putPixel(img, w, h, x, b.y1 - t, c); }
        for (int y = b.y0; y <= b.y1; y++) { putPixel(img, w, h, b.x0 + t, y, c); putPixel(img, w, h, b.x1 - t, y, c); }
    }
}

// The model is loaded here, on this task's 12 kB stack and 2 s after boot, not on app_main: loaded there, every second
// boot without the camera panicked in the constructor (2026-11-01, breadcrumb stage 61: timing dependent, the main
// task's stack is small and interrupts land on it).
static bool loadModel() {
    int64_t t0 = esp_timer_get_time();
    sys::note(61);
    model = new COCODetect(COCODetect::YOLO11N_320_S8_V1, false);
    sys::note(62);
    model->set_score_thr(thr, 0);
    model->set_nms_thr(DET_NMS_THR, 0);
    mOk = model->get_raw_model(0) != nullptr;
    ESP_LOGI(TAG, "model %s loaded in %d ms, %u kB PSRAM free", det::modelName(), (int)((esp_timer_get_time() - t0) / 1000),
             (unsigned)(heap_caps_get_free_size(MALLOC_CAP_SPIRAM) / 1024));
    return mOk;
}
static void taskFn(void*) {
    vTaskDelay(pdMS_TO_TICKS(2000));         // let Wi-Fi, mDNS and the web server settle first
    bool loaded = loadModel();
    loadDone = true;
    if (!loaded) { ESP_LOGE(TAG, "model did not load, detector off"); vTaskDelete(nullptr); }
    uint32_t seq = 0, fpsN = 0;
    int64_t fpsT0 = esp_timer_get_time();
    while (true) {
        if (!on || !cam::ok()) {
            vTaskDelay(pdMS_TO_TICKS(100));
            continue;
        }
        if (thrDirty) {
            model->set_score_thr(thr, 0);
            thrDirty = false;
        }
        int w = cam::width(), h = cam::height();
        if (!frame) frame = (uint8_t*)heap_caps_malloc(cam::frameBytes(), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);   // once, the camera size never changes
        if (!frame) { ESP_LOGE(TAG, "no PSRAM for the frame copy"); vTaskDelay(pdMS_TO_TICKS(1000)); continue; }
        int64_t ts = 0;
        if (!cam::copyFrame(frame, &ts)) {
            vTaskDelay(pdMS_TO_TICKS(50));
            continue;
        }
        int64_t t0 = esp_timer_get_time();
        dl::image::img_t img = {frame, (uint16_t)w, (uint16_t)h,
                                be ? dl::image::DL_IMAGE_PIX_TYPE_RGB565BE : dl::image::DL_IMAGE_PIX_TYPE_RGB565LE};
        auto& res = model->run(img);
        int64_t t1 = esp_timer_get_time();

        det::Result r;
        r.seq = ++seq;
        r.tsUs = ts;
        r.w = w;
        r.h = h;
        r.inferMs = (int)((t1 - t0) / 1000);
        for (const auto& d : res) {
            det::Box b = {d.category, d.score, d.box[0], d.box[1], d.box[2], d.box[3]};
            if (b.x0 > b.x1) std::swap(b.x0, b.x1);
            if (b.y0 > b.y1) std::swap(b.y0, b.y1);
            r.boxes.push_back(b);
        }
        for (const auto& b : r.boxes) drawBox(frame, w, h, b);
        uint8_t* j = nullptr;
        size_t jl = 0;
        bool jOk = cam::encodeRgb565(frame, w, h, &j, &jl);

        fpsN++;
        int64_t now = esp_timer_get_time();
        if (now - fpsT0 >= 3000000) {
            fpsVal = fpsN * 1000000.0f / (now - fpsT0);
            fpsN = 0;
            fpsT0 = now;
        }

        xSemaphoreTake(lock, portMAX_DELAY);
        last = r;
        if (jOk) {
            if (jpg) free(jpg);
            jpg = j;
            jpgLen = jl;
        }
        xSemaphoreGive(lock);
        if (seq % 10 == 1) ESP_LOGI(TAG, "frame %u: %d boxes in %d ms", (unsigned)seq, (int)r.boxes.size(), r.inferMs);
        vTaskDelay(1);   // let the idle task breathe between frames
    }
}

namespace det {

bool begin() {
    lock = xSemaphoreCreateMutex();          // the camera may be off now: the task waits for it (cam::ok())
    if (!cam::present()) {                   // no camera module: nothing to look at, the model is not loaded (saves PSRAM and the risky load)
        loadDone = true;
        on = false;
        ESP_LOGI(TAG, "no camera module: detector not started");
        return false;
    }
    return xTaskCreatePinnedToCore(taskFn, "yolo", DET_TASK_STACK, nullptr, DET_TASK_PRIO, nullptr, DET_TASK_CORE) == pdPASS;
}

bool modelOk() { return mOk; }
bool loadFinished() { return loadDone; }
const char* modelName() { return "yolo11n_320_s8_v1"; }
void setEnabled(bool v) { on = v && cam::present(); }   // no camera module: it stays off whatever is asked
bool enabled() { return on; }
void setThreshold(float t) {
    if (t < 0.05f) t = 0.05f;
    if (t > 0.95f) t = 0.95f;
    thr = t;
    thrDirty = true;
}
float threshold() { return thr; }
void setBigEndian(bool v) { be = v; }
bool bigEndian() { return be; }
Result latest() {
    xSemaphoreTake(lock, portMAX_DELAY);
    Result r = last;
    xSemaphoreGive(lock);
    return r;
}
float fps() { return on ? fpsVal : 0; }
bool analysedJpeg(uint8_t** out, size_t* len) {
    xSemaphoreTake(lock, portMAX_DELAY);
    bool good = jpg && jpgLen;
    if (good) {
        *out = (uint8_t*)heap_caps_malloc(jpgLen, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
        good = *out != nullptr;
        if (good) {
            memcpy(*out, jpg, jpgLen);
            *len = jpgLen;
        }
    }
    xSemaphoreGive(lock);
    return good;
}
const char* className(int c) { return (c >= 0 && c < 80) ? COCO_NAMES[c] : "?"; }

}  // namespace det
