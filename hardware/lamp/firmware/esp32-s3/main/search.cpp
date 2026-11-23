#include "search.h"
#include "config.h"
#include "camera.h"
#include "detector.h"
#include "light.h"
#include "servo.h"
#include <algorithm>
#include <cmath>
#include <cstring>
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

static const char* TAG = "search";

namespace search {

struct Fruit { const char* name; int cls; light::RGB col; };
#define X(n, c, r, g, b) {n, c, {r, g, b}},
static const Fruit FRUITS[] = {SEARCH_FRUITS};
#undef X
static const int NFRUITS = sizeof(FRUITS) / sizeof(FRUITS[0]);
static const int IGNORE[] = SEARCH_IGNORE;
static const float YAWS[] = SEARCH_YAWS;
static const int NYAWS = sizeof(YAWS) / sizeof(YAWS[0]);
static const light::RGB OTHER = SEARCH_OTHER_COLOR;

enum State { OFF, SWEEP, NOTHING, FOUND };
static const char* const STATE_NAMES[] = {"off", "sweep", "nothing", "found"};
static State st = OFF;
static bool onV = false;
static int stopI = 0, dwell = 0, lost = 0, skip = 0, hits = 0;   // hits: the last 3 detections, bit set = a candidate was in it
static int nHits() { return (hits & 1) + ((hits >> 1) & 1) + ((hits >> 2) & 1); }
static uint32_t lastSeq = 0;
static int64_t nothingT0 = 0;
static int tCls = -1;
static float tScore = 0;
static std::string tName, seenV;
static SemaphoreHandle_t mtx;
static bool torqueWarned = false;

static int64_t ms() { return esp_timer_get_time() / 1000; }

// What the last detection holds, for the search: the fruit to point at (first in SEARCH_FRUITS order), the colours of
// every fruit kind seen, or one other known object when there is no fruit.
struct Pick {
    int cls = -1;
    float score = 0, cx = 0, cy = 0;
    const char* name = "";
    light::RGB cols[4];
    int ncols = 0;
    std::string seen;
};
static bool ignored(int cls) { for (int c : IGNORE) if (c == cls) return true; return false; }
static int priority(int cls) { for (int f = 0; f < NFRUITS; f++) if (FRUITS[f].cls == cls) return f; return NFRUITS; }   // 0 = first fruit, NFRUITS = other object
static Pick evaluate(const det::Result& r) {
    Pick p;
    for (int f = 0; f < NFRUITS && p.ncols < 4; f++) {
        const det::Box* best = nullptr;
        for (const auto& b : r.boxes) if (b.cls == FRUITS[f].cls && b.score >= SEARCH_FRUIT_THR && (!best || b.score > best->score)) best = &b;
        if (!best) continue;
        p.cols[p.ncols++] = FRUITS[f].col;
        if (!p.seen.empty()) p.seen += ", ";
        p.seen += FRUITS[f].name;
        if (p.cls < 0) { p.cls = best->cls; p.score = best->score; p.name = FRUITS[f].name; p.cx = (best->x0 + best->x1) / 2.0f; p.cy = (best->y0 + best->y1) / 2.0f; }
    }
    if (p.cls >= 0) return p;
    const det::Box* only = nullptr;
    int n = 0;
    for (const auto& b : r.boxes) if (!ignored(b.cls) && b.score >= SEARCH_OTHER_THR) { n++; only = &b; }
    if (n == 1) {
        p.cls = only->cls; p.score = only->score; p.name = det::className(only->cls);
        p.cx = (only->x0 + only->x1) / 2.0f; p.cy = (only->y0 + only->y1) / 2.0f;
        p.cols[0] = OTHER; p.ncols = 1;
    }
    return p;
}

static void pose(float yaw, float sh, float el, float wr) {
    float q[servo::NJ] = {yaw, sh, el, wr, 0};
    bool has[servo::NJ] = {true, true, true, true, true};
    if (!servo::setPose(q, has)) ESP_LOGW(TAG, "pose refused (shade too low): yaw %.0f sh %.0f el %.0f wr %.0f", yaw, sh, el, wr);
    skip = 2;                               // a big move takes about 1 s and a detection 1.5 s: the next two results were grabbed before or during it
    hits = 0;
}
static void setTarget(const Pick& p) {
    xSemaphoreTakeRecursive(mtx, portMAX_DELAY);
    tCls = p.cls; tScore = p.score; tName = p.cls >= 0 ? p.name : ""; seenV = p.seen;
    xSemaphoreGiveRecursive(mtx);
}
static void restoreBri();
static void enterSweep() {
    st = SWEEP; stopI = 0; dwell = 0; lost = 0; hits = 0;
    setTarget(Pick());
    restoreBri();
    light::setMode("search");
    pose(YAWS[0], SEARCH_POSE);
    ESP_LOGI(TAG, "sweep: stop 0, yaw %.0f", YAWS[0]);
}
static void enterNothing() {
    st = NOTHING; nothingT0 = ms();
    light::setMode("nothing");
    ESP_LOGI(TAG, "nothing found, again in %d s", SEARCH_RETRY_S);
}
static int savedBri = -1;                   // ring brightness from before the found state dimmed it
static void restoreBri() {
    if (savedBri < 0) return;
    light::Params lp = light::get();
    lp.bri = (uint8_t)savedBri;
    light::set(lp);
    savedBri = -1;
}
static void showFound(const Pick& p) {
    light::setParts(p.cols, p.ncols);
    light::Params lp = light::get();
    if (savedBri < 0) savedBri = lp.bri;
    lp.bri = SEARCH_FOUND_BRI;              // the colour must not flood the table: it costs the model most of its score
    lp.mode = light::PARTS;
    light::set(lp);
    setTarget(p);
}
static void enterFound(const Pick& p) {
    st = FOUND; lost = 0;
    showFound(p);
    float yaw = servo::joint(0).target;
    pose(yaw, SEARCH_FOUND_POSE);
    ESP_LOGI(TAG, "found %s %.0f%% at %.0f,%.0f (%s): coming down", p.name, p.score * 100, p.cx, p.cy, p.seen.c_str());
}
// One correction toward the picture centre. The picture is turned in the head (see SEARCH_YAW_PX / SEARCH_WRIST_PX),
// so the two joint steps are solved together: find dyaw, dwr with dyaw * YAW_PX + dwr * WRIST_PX = -(ex, ey).
static const float YAW_PX[2] = SEARCH_YAW_PX, WRIST_PX[2] = SEARCH_WRIST_PX;
static void centre(const Pick& p, int w, int h) {
    float ex = p.cx - w / 2.0f, ey = p.cy - h / 2.0f;
    if (ex * ex + ey * ey < (float)SEARCH_DEADBAND * SEARCH_DEADBAND) return;
    float det = YAW_PX[0] * WRIST_PX[1] - WRIST_PX[0] * YAW_PX[1];
    if (fabsf(det) < 0.1f) { ESP_LOGW(TAG, "SEARCH_YAW_PX and SEARCH_WRIST_PX are parallel: no centring"); return; }
    float dyaw = (-WRIST_PX[1] * ex + WRIST_PX[0] * ey) / det;
    float dwr = (-YAW_PX[0] * ey + YAW_PX[1] * ex) / det;
    servo::Joint wr = servo::joint(3), yw = servo::joint(0);
    dyaw = std::min(std::max(dyaw * SEARCH_GAIN, -SEARCH_MAX_STEP), SEARCH_MAX_STEP);
    dwr = std::min(std::max(dwr * SEARCH_GAIN, -SEARCH_MAX_STEP), SEARCH_MAX_STEP);
    float q[servo::NJ] = {yw.target + dyaw, 0, 0, wr.target + dwr, 0};
    bool has[servo::NJ] = {true, false, false, true, false};
    servo::setPose(q, has);
    skip = 1;
    ESP_LOGI(TAG, "%s at %+.0f,%+.0f px: yaw %+.1f wrist %+.1f", p.name, ex, ey, dyaw, dwr);
}

static void stopLocked(const char* why);
// One step of the search, with the mutex held: setOn(false) takes the same mutex, so the off cannot land in the
// middle of a step (0.25: a found step after the off left the ring dim in "parts").
static void tick() {
    if (!onV) return;
    if (!cam::ok()) { stopLocked("the camera is off"); return; }   // it did not start, or /api/cam?on=0 came while searching
    if (st == OFF) { enterSweep(); return; }
    if (!servo::torque() && !torqueWarned) { torqueWarned = true; ESP_LOGW(TAG, "torque is off: the light and the states run, the head does not move"); }
    if (st == NOTHING && ms() - nothingT0 > SEARCH_RETRY_S * 1000) { enterSweep(); return; }
    det::Result r = det::latest();
    if (r.seq == lastSeq) return;
    lastSeq = r.seq;
    if (skip > 0) { skip--; return; }            // that frame was grabbed before the last move finished
    Pick p = evaluate(r);
    switch (st) {
        case SWEEP:
            hits = ((hits << 1) | (p.cls >= 0 ? 1 : 0)) & 7;
            if (p.cls >= 0) {                   // a candidate: stay at this stop until it is confirmed or gone
                if (nHits() >= SEARCH_CONFIRM) enterFound(p);
                else ESP_LOGI(TAG, "%s %.0f%% once, waiting for a second look", p.name, p.score * 100);
                break;
            }
            if (++dwell >= SEARCH_DWELL) {
                dwell = 0;
                if (++stopI >= NYAWS) enterNothing();
                else { pose(YAWS[stopI], SEARCH_POSE); ESP_LOGI(TAG, "sweep: stop %d, yaw %.0f", stopI, YAWS[stopI]); }
            }
            break;
        case NOTHING:
            hits = ((hits << 1) | (p.cls >= 0 ? 1 : 0)) & 7;
            if (p.cls >= 0 && nHits() >= SEARCH_CONFIRM) enterFound(p);
            break;
        case FOUND:
            if (p.cls >= 0 && (p.cls == tCls || priority(p.cls) < priority(tCls) || lost + 1 >= SEARCH_LOST)) {
                // the target itself, a fruit that outranks it, or the target has been gone long enough: point at it
                lost = 0;
                if (p.cls != tCls) ESP_LOGI(TAG, "now pointing at %s (%s)", p.name, p.seen.c_str());
                showFound(p);
                centre(p, r.w, r.h);
            } else if (p.cls >= 0) {            // only a lesser fruit this time: show it, hold the head, wait for the target
                lost++;
                light::setParts(p.cols, p.ncols);
            } else if (++lost >= SEARCH_LOST) {
                ESP_LOGI(TAG, "lost it: sweeping again");
                enterSweep();
            }
            break;
        default: break;
    }
}
static void taskFn(void*) {
    while (true) {
        vTaskDelay(pdMS_TO_TICKS(100));
        xSemaphoreTakeRecursive(mtx, portMAX_DELAY);
        tick();
        xSemaphoreGiveRecursive(mtx);
    }
}

void begin() {
    mtx = xSemaphoreCreateRecursiveMutex();
    xTaskCreatePinnedToCore(taskFn, "search", 4096, nullptr, 1, nullptr, 0);
}
static float savedThr = -1;                 // the model threshold from before the search lowered it
static bool startedCam = false, startedDet = false;   // what the search switched on, to switch off again
// Off: everything the search switched on or changed goes back. Called with the mutex held, from setOn() or from the
// search task itself (camera gone).
static void stopLocked(const char* why) {
    onV = false;
    st = OFF;
    setTarget(Pick());
    restoreBri();
    light::setMode(light::idleMode());
    // the model threshold goes back, unless the slider was moved during the search: then that value stays
    if (savedThr >= 0 && fabsf(det::threshold() - SEARCH_FRUIT_THR) < 0.001f) det::setThreshold(savedThr);
    savedThr = -1;
    if (startedDet) { det::setEnabled(false); startedDet = false; }
    if (startedCam) { cam::stop(); startedCam = false; }
    ESP_LOGI(TAG, "off%s%s", why ? ": " : "", why ? why : "");
}
void setOn(bool on) {
    xSemaphoreTakeRecursive(mtx, portMAX_DELAY);
    if (on && !cam::present()) {            // no camera module: there is nothing to search with
        ESP_LOGW(TAG, "no camera module on this lamp: the search stays off");
        xSemaphoreGiveRecursive(mtx);
        return;
    }
    if (on != onV) {
        torqueWarned = false;
        if (on) {                           // the search filters by class itself: let weak fruit boxes through
            ESP_LOGI(TAG, "ON");
            if (!cam::ok()) { startedCam = cam::start(); if (!startedCam) ESP_LOGE(TAG, "camera did not start"); }
            if (!det::enabled()) { det::setEnabled(true); startedDet = true; }
            savedThr = det::threshold();
            if (savedThr > SEARCH_FRUIT_THR) det::setThreshold(SEARCH_FRUIT_THR);
            onV = true;                     // the task starts the sweep; with a camera that did not start it stops again at once
        } else {
            stopLocked(nullptr);
        }
    }
    xSemaphoreGiveRecursive(mtx);
}
bool on() { return onV; }
const char* state() { return STATE_NAMES[st]; }
std::string target() { xSemaphoreTakeRecursive(mtx, portMAX_DELAY); std::string s = tName; xSemaphoreGiveRecursive(mtx); return s; }
int targetCls() { return tCls; }
float targetScore() { return tScore; }
std::string seen() { xSemaphoreTakeRecursive(mtx, portMAX_DELAY); std::string s = seenV; xSemaphoreGiveRecursive(mtx); return s; }
int stop() { return stopI; }

}  // namespace search
