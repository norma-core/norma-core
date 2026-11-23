#include "light.h"
#include "config.h"
#include <algorithm>
#include <cmath>
#include <cstring>
#include <ctime>
#include <sys/time.h>
#include "esp_log.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "led_strip.h"
#include "nvs.h"

static const char* TAG = "light";

namespace light {

static const char* const MODE_NAMES[NMODES] = {"off",  "solid",   "breathe", "rainbow",  "comet", "chase", "scanner",
                                               "sparkle", "fire", "follow",  "reactive", "clock", "eye", "search", "nothing", "parts",
                                               "aurora", "stars", "mood", "update"};
static const char* const IDLE_CHOICES[] = {"aurora", "stars", "mood", "rainbow", "random"};
static const int NIDLE = 5;
static char idleSet[12] = "random";       // the saved choice
static Mode idleNow = AURORA;             // what it resolved to this boot
static RGB parts[4] = {{255, 210, 0}, {20, 255, 40}, {255, 110, 0}, {170, 60, 255}};
static int nParts = 1;   // under mtx
static const RGB RADAR = {40, 200, 255}, NOTHING_RED = {255, 16, 0};
const RGB CLOCK_HOUR = {255, 177, 92}, CLOCK_MINUTE = {170, 60, 255}, CLOCK_SECOND = {255, 100, 0};
static const RGB AURORA_GREEN = {0, 255, 70}, AURORA_TEAL = {0, 180, 170}, AURORA_VIOLET = {110, 30, 255};
static const RGB STAR = {170, 190, 255}, SKY = {0, 0, 4};
static const RGB UPDATE_FILL = {40, 120, 255}, UPDATE_REST = {0, 0, 8};
const RGB GREEN = {0, 255, 40}, RED = {255, 0, 0};
static RGB flashCol = {0, 0, 0};
static double flashUntil = 0;        // esp_timer seconds; under mtx

static led_strip_handle_t strip = nullptr;
static SemaphoreHandle_t mtx = nullptr;
static Params P;                     // the parameters, under mtx
static uint8_t frame[LED_COUNT * 3]; // last rendered frame, clock order, under mtx
static bool sOk = false;

// ---- effect state (render task only)
static float sparkle[LED_COUNT], heat[LED_COUNT];
static float phase = 0, act = 0, lids = 1;
static double lastT = 0, lastMove = 0;
static float star[LED_COUNT], starDir[LED_COUNT];              // stars: brightness, +1 rising / -1 fading / 0 off
static float shootPos = -1, shootStart = 0;                    // stars: shooting star (LEDs from its start)
static double shootNext = 0;                                   // stars: when the next one comes (esp_timer seconds)
// The time is a double. A float of the uptime in seconds has no room for a 33 ms frame after a few days (the step
// between frames became uneven after 3 days and the comet moved in jumps after a week), so every "t x speed" product
// is reduced to its period in double once a frame (step()) and the per-LED code only sees these small floats.
static float phBreathe = 0, phRainbow = 0, phComet = 0, phChase = 0, phScanner = 0, phClock = 0, phSearch = 0, phNothing = 0,
             phAurora[4] = {0, 0, 0, 0}, phUpdate = 0;
static float moodHue = 0;
static RGB partsR[4];        // render task's copy of the sector colours
static int nPartsR = 1;
static RGB wb = {1, 1, 1};
static uint16_t wbCt = 0;
static constexpr float REACTIVE_IDLE_S = 4, REACTIVE_IDLE_BRI = 0.6f;
static constexpr float DEG = (float)M_PI / 180.0f;

static inline float clampf(float v, float lo, float hi) { return v < lo ? lo : v > hi ? hi : v; }
static inline RGB mix(RGB a, RGB b, float k) { return {a.r + (b.r - a.r) * k, a.g + (b.g - a.g) * k, a.b + (b.b - a.b) * k}; }
static inline RGB scale(RGB c, float k) { return {c.r * k, c.g * k, c.b * k}; }
static inline RGB add(RGB a, RGB b) { return {a.r + b.r, a.g + b.g, a.b + b.b}; }
static inline float wrapDist(float a, float b, int n) { float d = fmodf(fabsf(a - b), n); return std::min(d, n - d); }
static inline float frand() { return (float)esp_random() / 4294967296.0f; }
static float hand(int i, float pos, int n, float hw) { return std::max(0.0f, 1 - wrapDist(i, pos, n) / hw); }
static RGB hsv(float h, float s, float v) {
    h -= floorf(h);
    int i = (int)(h * 6);
    float f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s), r, g, b;
    switch (i % 6) {
        case 0: r = v; g = t; b = p; break;
        case 1: r = q; g = v; b = p; break;
        case 2: r = p; g = v; b = t; break;
        case 3: r = p; g = q; b = v; break;
        case 4: r = t; g = p; b = v; break;
        default: r = v; g = p; b = q; break;
    }
    return {r * 255, g * 255, b * 255};
}
// Channel gains for a white point of `kelvin`, relative to the strip's own white (6500): the black-body colour
// (Tanner Helland's fit) divided by the colour at 6500, scaled so no gain exceeds 1.
static RGB blackBody(float kelvin) {
    float t = kelvin / 100, r, g, b;
    if (t <= 66) { r = 255; g = 99.4708f * logf(t) - 161.1196f; b = t <= 19 ? 0 : 138.5177f * logf(t - 10) - 305.0448f; }
    else { r = 329.6987f * powf(t - 60, -0.1332f); g = 288.1222f * powf(t - 60, -0.0755f); b = 255; }
    return {clampf(r, 0, 255), clampf(g, 0, 255), clampf(b, 0, 255)};
}
static RGB whiteBalance(uint16_t kelvin) {
    RGB w = blackBody(kelvin), n = blackBody(6500);
    RGB g = {w.r / n.r, w.g / n.g, w.b / n.b};
    float m = std::max(g.r, std::max(g.g, g.b));
    return {g.r / m, g.g / m, g.b / m};
}
static RGB sparklePx(const Params& p, int i, int n) {
    if (frand() < 0.012f * p.spd / n) sparkle[i] = 1;
    sparkle[i] *= 0.9f;
    return mix(scale(p.c2, 0.12f), p.c1, sparkle[i]);
}

// Once a frame: the state the idle effects carry from frame to frame (speed 40 = 1x)
static void step(const Params& p, double t, float dt) {
    const int n = LED_COUNT;
    float sp = p.spd / 40.0f;
    const double TAU = 2 * M_PI, ts = t * p.spd / 40;
    phBreathe = (float)fmod(t * p.spd * 0.08, TAU);
    phRainbow = (float)fmod(t * p.spd * 0.004, 1.0);
    phComet = (float)fmod(t * p.spd * 0.3, n);
    phChase = (float)fmod(t * p.spd * 0.15, p.w * 2.0);
    phScanner = (float)fmod(t * p.spd * 0.04, TAU);
    phClock = (float)fmod(t, 60.0);
    phSearch = (float)fmod(t * p.spd * 0.5, n);
    phNothing = (float)fmod(t * 1.5, TAU);
    phAurora[0] = (float)fmod(ts * 0.21, TAU); phAurora[1] = (float)fmod(ts * 0.13, TAU);
    phAurora[2] = (float)fmod(ts * 0.07, TAU); phAurora[3] = (float)fmod(ts * 0.37, TAU);
    phUpdate = (float)fmod(t * 8, TAU);
    switch (p.mode) {
        case STARS: {
            if (frand() < dt * 1.5f * sp) { int i = esp_random() % n; if (starDir[i] == 0) starDir[i] = 1; }   // a new star about every 0.7 s
            for (int i = 0; i < n; i++) {
                if (starDir[i] > 0) { star[i] += dt * 1.2f * sp; if (star[i] >= 1) { star[i] = 1; starDir[i] = -1; } }
                else if (starDir[i] < 0) { star[i] -= dt * 0.45f * sp; if (star[i] <= 0) { star[i] = 0; starDir[i] = 0; } }
            }
            if (shootNext == 0) shootNext = t + 8 + frand() * 20;
            if (shootPos < 0 && t > shootNext) { shootPos = 0; shootStart = esp_random() % n; }
            if (shootPos >= 0) { shootPos += dt * 60 * sp; if (shootPos > n + 8) { shootPos = -1; shootNext = t + 15 + frand() * 30; } }
            break;
        }
        case MOOD: moodHue = fmodf(moodHue + dt * 0.004f * sp, 1); break;
        default: break;
    }
}

static RGB pixel(const Params& p, int i, int n) {
    switch (p.mode) {
        case OFF: return {0, 0, 0};
        case SOLID: return p.c1;
        case BREATHE: return scale(p.c1, 0.15f + 0.85f * (0.5f - 0.5f * cosf(phBreathe)));
        case RAINBOW: return hsv((float)i / n + phRainbow, 1, 1);
        case COMET: {
            float head = phComet, d = fmodf(head - i + n, n), a = std::max(0.0f, 1 - d / (p.w * 2));
            return scale(p.c1, a * a);
        }
        case CHASE: { float k = fmodf(i + phChase, p.w * 2.0f); return k < p.w ? p.c1 : scale(p.c2, 0.25f); }
        case SCANNER: {
            float c = n / 2.0f + (n / 2.0f - 1) * sinf(phScanner);
            return scale(p.c1, powf(std::max(0.0f, 1 - wrapDist(i, c, n) / p.w), 1.5f));
        }
        case SPARKLE: return sparklePx(p, i, n);
        case FIRE: {
            heat[i] = std::max(0.0f, heat[i] - frand() * 0.06f * p.spd / 40);
            if (frand() < 0.08f) heat[i] = std::min(1.0f, heat[i] + frand() * 0.8f);
            float h = (heat[i] + heat[(i + 1) % n] + heat[(i + n - 1) % n]) / 3;
            return h < 0.5f ? mix({20, 0, 0}, {255, 60, 0}, h * 2) : mix({255, 60, 0}, {255, 220, 120}, (h - 0.5f) * 2);
        }
        // follow: the sector stays where it is in the room: the head roll is taken out of the aim.
        case FOLLOW: {
            float a = fmodf(fmodf(p.aim - LED_ROLL_SIGN * p.roll, 360) + 360, 360);
            return scale(p.c1, powf(std::max(0.0f, 1 - wrapDist(i, a * n / 360, n) / p.w), 1.5f));
        }
        // reactive: a dim glow of the main colour that brightens with movement, plus a comet that runs round the ring
        // with the movement and stops with it; after REACTIVE_IDLE_S at rest it fades into the sparkle pattern.
        case REACTIVE: {
            RGB sp = scale(sparklePx(p, i, n), REACTIVE_IDLE_BRI);
            bool c2black = p.c2.r + p.c2.g + p.c2.b < 1;
            RGB glow = scale(p.c1, 0.06f + 0.24f * p.motion);
            float d = wrapDist(i, phase, n);
            float comet = p.motion * std::max(0.0f, 1 - d / (p.w * 1.5f));
            return mix(sp, mix(glow, c2black ? p.c1 : p.c2, comet * comet), act);
        }
        // clock: hour hand amber and wide, minute hand violet, second hand orange, 12 faint hour marks. Without time
        // one dim orange dot sweeps once a minute.
        case CLOCK: {
            if (p.tod < 0) return scale(CLOCK_SECOND, 0.5f * hand(i, phClock * n / 60, n, 1.0f));
            float mark = fmodf(roundf(i * 12.0f / n), 12) * n / 12.0f;
            RGB c = scale(CLOCK_HOUR, 0.04f * hand(i, mark, n, 0.7f));
            c = add(c, scale(CLOCK_HOUR, powf(hand(i, fmodf(p.tod / 3600, 12) * n / 12, n, 2.2f), 1.5f)));
            c = add(c, scale(CLOCK_MINUTE, 0.85f * powf(hand(i, fmodf(p.tod / 60, 60) * n / 60, n, 1.4f), 1.5f)));
            c = add(c, scale(CLOCK_SECOND, hand(i, fmodf(p.tod, 60) * n / 60, n, 1.0f)));
            return c;
        }
        // eye: lids top and bottom; the light comes in at the corners (9 and 3 o'clock) and reaches 12 and 6 last.
        case EYE: {
            float a = ((float)i / n * 360 + LED_ROLL_SIGN * p.roll) * DEG;
            float lid = clampf((lids * 1.1f - fabsf(cosf(a))) / 0.12f, 0, 1);
            return scale(p.c1, 0.03f + 0.97f * lid);
        }
        // search: a radar sweep, one bright head with a tail a third of the ring long running round, over a faint glow
        case SEARCH: {
            float head = phSearch, d = fmodf(head - i + n, n), tail = n / 3.0f;
            float a = std::max(0.0f, 1 - d / tail);
            return scale(RADAR, 0.04f + 0.96f * a * a);
        }
        // nothing found: a slow dim red breath
        case NOTHING: return scale(NOTHING_RED, 0.05f + 0.20f * (0.5f - 0.5f * cosf(phNothing)));
        // parts: equal sectors in the colours set with setParts(), the first one starting at 12 o'clock
        case PARTS: {
            int np = std::max(1, std::min(nPartsR, 4));
            int k = std::min(np - 1, (int)(i * np / n));
            return partsR[k];
        }
        // aurora: three slow waves of different lengths make bright and dark curtains that drift and never repeat;
        // the colour runs green -> teal -> violet along a fourth, slower wave. All waves fit the ring a whole number of times.
        case AURORA: {
            float x = (float)i / n * 6.2832f;
            float a = sinf(x + phAurora[0]), b = sinf(x * 2 - phAurora[1] + 1.3f), c = 0.5f + 0.5f * sinf(x + phAurora[2] + 2.0f);
            float v = clampf(0.55f + 0.5f * a * b + 0.2f * sinf(x * 3 + phAurora[3]), 0, 1);
            RGB col = c < 0.5f ? mix(AURORA_GREEN, AURORA_TEAL, c * 2) : mix(AURORA_TEAL, AURORA_VIOLET, (c - 0.5f) * 2);
            return scale(col, 0.03f + 0.97f * v * v);
        }
        // stars: each star rises in about a second and fades in two; a shooting star runs one lap with a tail
        case STARS: {
            RGB c = add(SKY, scale(STAR, star[i] * star[i]));
            if (shootPos >= 0) {
                float d = shootPos - (float)(((int)(i - shootStart) % n + n) % n);
                if (d >= 0 && d < 8) c = add(c, scale(STAR, (1 - d / 8) * (1 - d / 8)));
            }
            return c;
        }
        // update: a blue bar from 12 o'clock clockwise as far as the upload got, its last LED pulsing; the rest near-black
        case UPDATE: {
            float fill = clampf(p.progress, 0, 1) * n;
            if (i + 1 <= fill) return UPDATE_FILL;
            if (i < fill) return mix(UPDATE_REST, UPDATE_FILL, (fill - i) * (0.6f + 0.4f * sinf(phUpdate)));
            return UPDATE_REST;
        }
        // mood: the sparkle effect in a colour that drifts round the hue circle (about 4 min a lap at speed 40)
        case MOOD: {
            RGB c1 = hsv(moodHue, 1, 1);
            if (frand() < 0.012f * p.spd / n) sparkle[i] = 1;
            sparkle[i] *= 0.9f;
            return mix(scale(c1, 0.10f), c1, sparkle[i]);
        }
        default: return {0, 0, 0};
    }
}

static float timeOfDay() {
    struct timeval tv;
    gettimeofday(&tv, nullptr);
    if (tv.tv_sec < 1600000000) return -1;
    struct tm lt;
    localtime_r(&tv.tv_sec, &lt);
    return lt.tm_hour * 3600 + lt.tm_min * 60 + lt.tm_sec + tv.tv_usec / 1e6f;
}

static void render(double t) {
    const int n = LED_COUNT;
    const int start = (int)lroundf(LED_START_DEG * n / 360.0f);
    xSemaphoreTake(mtx, portMAX_DELAY);
    P.tod = timeOfDay();
    Params p = P;
    memcpy(partsR, parts, sizeof parts);
    nPartsR = nParts;
    bool flashing = t < flashUntil, flashOn = flashing && fmodf((float)(flashUntil - t), 0.5f) >= 0.25f;
    RGB fc = flashCol;
    xSemaphoreGive(mtx);
    float dt = lastT > 0 ? (float)std::min(t - lastT, 0.1) : 0;
    lastT = t;
    if (p.ct != wbCt) { wb = whiteBalance(p.ct); wbCt = p.ct; }
    step(p, t, dt);
    phase = fmodf(phase + dt * p.spd * 0.6f * p.motion * p.dir + n, n);
    lids += clampf(p.eye - lids, -dt * p.spd / 40, dt * p.spd / 40);
    if (p.motion > 0.05f) { lastMove = t; act += (1 - act) * std::min(1.0f, dt * 10); }
    else if (t - lastMove > REACTIVE_IDLE_S) act += (0 - act) * std::min(1.0f, dt * 1.2f);
    float k = std::min((int)p.bri, LED_MAX_BRI) / 255.0f;
    uint8_t f[LED_COUNT * 3];
    for (int i = 0; i < n; i++) {
        RGB c = flashing ? (flashOn ? fc : RGB{0, 0, 0}) : pixel(p, i, n);
        uint8_t r = (uint8_t)clampf(c.r * k * wb.r, 0, 255), g = (uint8_t)clampf(c.g * k * wb.g, 0, 255), b = (uint8_t)clampf(c.b * k * wb.b, 0, 255);
        f[i * 3] = r; f[i * 3 + 1] = g; f[i * 3 + 2] = b;
        int phys = ((LED_DIR > 0 ? i - start : start - i) % n + n) % n;
        led_strip_set_pixel(strip, phys, r, g, b);
    }
    led_strip_refresh(strip);
    xSemaphoreTake(mtx, portMAX_DELAY);
    memcpy(frame, f, sizeof frame);
    xSemaphoreGive(mtx);
}

static Mode resolveIdle() {   // the saved choice as a mode; random: one of the other choices
    const char* name = idleSet;
    if (strcmp(name, "random") == 0) name = IDLE_CHOICES[esp_random() % (NIDLE - 1)];
    for (int k = 0; k < NMODES; k++) if (strcmp(MODE_NAMES[k], name) == 0) return (Mode)k;
    return AURORA;
}
bool setIdle(const char* name, bool apply) {
    int k = 0;
    while (k < NIDLE && strcmp(IDLE_CHOICES[k], name) != 0) k++;
    if (k == NIDLE) return false;
    strlcpy(idleSet, name, sizeof idleSet);
    nvs_handle_t h;
    if (nvs_open("lamp", NVS_READWRITE, &h) == ESP_OK) { nvs_set_str(h, "idle", idleSet); nvs_commit(h); nvs_close(h); }
    Mode m = resolveIdle();
    xSemaphoreTake(mtx, portMAX_DELAY);
    idleNow = m;
    if (apply) P.mode = m;
    xSemaphoreGive(mtx);
    ESP_LOGI(TAG, "idle mode %s -> %s", idleSet, MODE_NAMES[m]);
    return true;
}
const char* idleSetting() { return idleSet; }
const char* idleMode() { return MODE_NAMES[idleNow]; }
int idleChoiceCount() { return NIDLE; }
const char* idleChoice(int k) { return k >= 0 && k < NIDLE ? IDLE_CHOICES[k] : ""; }

static void taskFn(void*) {
    TickType_t last = xTaskGetTickCount();
    while (true) {
        vTaskDelayUntil(&last, pdMS_TO_TICKS(1000 / LED_FPS));
        render(esp_timer_get_time() / 1e6);
    }
}

bool begin() {
    mtx = xSemaphoreCreateMutex();
    nvs_handle_t h;
    if (nvs_open("lamp", NVS_READONLY, &h) == ESP_OK) {
        uint16_t ct;
        if (nvs_get_u16(h, "ct", &ct) == ESP_OK) P.ct = ct;
        size_t len = sizeof idleSet;
        nvs_get_str(h, "idle", idleSet, &len);      // stays "random" when nothing is saved
        int k = 0;
        while (k < NIDLE && strcmp(IDLE_CHOICES[k], idleSet) != 0) k++;
        if (k == NIDLE) strlcpy(idleSet, "random", sizeof idleSet);   // a choice that no longer exists (candle)
        nvs_close(h);
    }
    idleNow = resolveIdle();
    P.mode = idleNow;
    ESP_LOGI(TAG, "idle mode %s -> %s", idleSet, MODE_NAMES[idleNow]);
    led_strip_config_t sc = {};
    sc.strip_gpio_num = LED_PIN;
    sc.max_leds = LED_COUNT;
    sc.led_model = LED_MODEL_WS2812;
    sc.color_component_format = LED_STRIP_COLOR_COMPONENT_FMT_GRB;
    sc.flags.invert_out = false;
    led_strip_rmt_config_t rc = {};
    rc.clk_src = RMT_CLK_SRC_DEFAULT;
    rc.resolution_hz = 10 * 1000 * 1000;
    rc.mem_block_symbols = 1024;        // with DMA the whole frame is queued at once: no flicker when Wi-Fi interrupts
    rc.flags.with_dma = true;
    esp_err_t e = led_strip_new_rmt_device(&sc, &rc, &strip);
    if (e != ESP_OK) {                  // no DMA channel free: plain RMT
        rc.mem_block_symbols = 64;
        rc.flags.with_dma = false;
        e = led_strip_new_rmt_device(&sc, &rc, &strip);
    }
    if (e != ESP_OK) {
        ESP_LOGE(TAG, "strip driver failed: %s", esp_err_to_name(e));
        return false;
    }
    led_strip_clear(strip);
    sOk = true;
    xTaskCreatePinnedToCore(taskFn, "light", 4096, nullptr, 2, nullptr, 0);
    ESP_LOGI(TAG, "%d LEDs on GPIO %d, %d fps", LED_COUNT, LED_PIN, LED_FPS);
    return true;
}
bool ok() { return sOk; }
Params get() { xSemaphoreTake(mtx, portMAX_DELAY); Params p = P; xSemaphoreGive(mtx); return p; }
void set(const Params& p) {
    xSemaphoreTake(mtx, portMAX_DELAY);
    float roll = P.roll, motion = P.motion, dir = P.dir, tod = P.tod, progress = P.progress;   // the measured values stay the module's
    P = p;
    P.roll = roll; P.motion = motion; P.dir = dir; P.tod = tod; P.progress = progress;
    xSemaphoreGive(mtx);
}
bool setMode(const char* name) {
    for (int k = 0; k < NMODES; k++)
        if (strcmp(MODE_NAMES[k], name) == 0) {
            xSemaphoreTake(mtx, portMAX_DELAY);
            P.mode = (Mode)k;
            xSemaphoreGive(mtx);
            return true;
        }
    return false;
}
const char* modeName(Mode m) { return m < NMODES ? MODE_NAMES[m] : "?"; }
int modeCount() { return NMODES; }
void setMotion(float motion, float dir, float roll) {
    xSemaphoreTake(mtx, portMAX_DELAY);
    P.motion += (motion - P.motion) * (motion > P.motion ? 0.25f : 0.05f);   // quick to light up, slow to fade
    if (fabsf(dir) > 5) P.dir = dir > 0 ? 1 : -1;
    P.roll += (roll - P.roll) * 0.25f;
    xSemaphoreGive(mtx);
}
void setParts(const RGB* cols, int n) {
    n = std::max(1, std::min(n, 4));
    xSemaphoreTake(mtx, portMAX_DELAY);
    for (int k = 0; k < n; k++) parts[k] = cols[k];
    nParts = n;
    xSemaphoreGive(mtx);
}
void setProgress(float v) {
    xSemaphoreTake(mtx, portMAX_DELAY);
    P.progress = v;
    xSemaphoreGive(mtx);
}
void flash(RGB c, int times) {
    xSemaphoreTake(mtx, portMAX_DELAY);
    flashCol = c;
    flashUntil = esp_timer_get_time() / 1e6 + 0.5 * std::max(1, times);
    xSemaphoreGive(mtx);
}
void saveWhiteBalance() {
    nvs_handle_t h;
    if (nvs_open("lamp", NVS_READWRITE, &h) != ESP_OK) return;
    nvs_set_u16(h, "ct", get().ct);
    nvs_commit(h);
    nvs_close(h);
}
std::string frameHex() {
    static const char* H = "0123456789abcdef";
    std::string s(LED_COUNT * 6, '0');
    xSemaphoreTake(mtx, portMAX_DELAY);
    for (int i = 0; i < LED_COUNT * 3; i++) { s[i * 2] = H[frame[i] >> 4]; s[i * 2 + 1] = H[frame[i] & 15]; }
    xSemaphoreGive(mtx);
    return s;
}
bool hasTime() { return time(nullptr) >= 1600000000; }
std::string clockStr() {
    time_t now = time(nullptr);
    if (now < 1600000000) return "";
    struct tm lt;
    localtime_r(&now, &lt);
    char b[12];
    strftime(b, sizeof b, "%H:%M:%S", &lt);
    return b;
}

}  // namespace light
