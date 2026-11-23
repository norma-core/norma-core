#include "servo.h"
#include <cstdio>
#include "config.h"
#include "light.h"
#include <algorithm>
#include <cmath>
#include <cstring>
#include "driver/uart.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "nvs.h"

static const char* TAG = "servo";

// ---------------------------------------------------------------- Feetech STS/SMS bus (ST3215)
// Protocol: FF FF ID LEN INSTR PARAMS... CHK, little-endian words. The driver board may echo what we send; a packet
// byte-identical to the one just sent is dropped, so both kinds of adapter work.
namespace {
enum : uint8_t { INST_PING = 1, INST_READ = 2, INST_WRITE = 3, INST_SYNC_WRITE = 0x83 };
enum : uint8_t { REG_MODE = 33, REG_TORQUE = 40, REG_ACC = 41, REG_GOAL_POS = 42, REG_LOCK = 55, REG_PRESENT_POS = 56, REG_CURRENT = 69 };
struct Status { bool ok = false; int16_t pos = 0, speed = 0, load = 0, current = 0; uint8_t volt10 = 0, temp = 0; };

uint8_t txbuf[96];
int txn = 0;
bool echoes = false;   // the adapter sends our own bytes back (found out once at boot)
SemaphoreHandle_t busMtx;

uint8_t chk(const uint8_t* p, int n) { uint8_t c = 0; for (int i = 2; i < n; i++) c += p[i]; return (uint8_t)~c; }
int64_t ms() { return esp_timer_get_time() / 1000; }
void sleepMs(int n) { vTaskDelay(pdMS_TO_TICKS(n)); }

void send(const uint8_t* p, int n) {
    uart_flush_input(BUS_UART);
    memcpy(txbuf, p, n);
    txn = n;
    uart_write_bytes(BUS_UART, p, n);
    uart_wait_tx_done(BUS_UART, pdMS_TO_TICKS(10));
}
// Next complete packet that is not an echo of what we just sent. Returns its length, 0 on timeout.
int readPacket(uint8_t* buf, int cap, uint32_t timeoutMs, int wantId = -1) {
    int64_t t0 = ms();
    int n = 0, state = 0;
    while (ms() - t0 < (int64_t)timeoutMs) {
        uint8_t c;
        if (uart_read_bytes(BUS_UART, &c, 1, pdMS_TO_TICKS(1)) != 1) continue;
        if (state == 0) { if (c == 0xFF) state = 1; continue; }
        if (state == 1) { if (c == 0xFF) { buf[0] = buf[1] = 0xFF; n = 2; state = 2; } else state = 0; continue; }
        if (n < cap) buf[n++] = c;
        if (n >= 4 && n >= buf[3] + 4) {
            if (echoes && n == txn && memcmp(buf, txbuf, n) == 0) { n = 0; state = 0; continue; }   // our own echo
            if (wantId >= 0 && buf[2] != wantId) { n = 0; state = 0; continue; }          // late reply from another servo
            return n;
        }
    }
    return 0;
}
void busWrite(uint8_t id, uint8_t reg, const uint8_t* data, uint8_t n) {
    uint8_t p[64];
    int k = 0;
    p[k++] = 0xFF; p[k++] = 0xFF; p[k++] = id; p[k++] = n + 3; p[k++] = INST_WRITE; p[k++] = reg;
    for (uint8_t i = 0; i < n; i++) p[k++] = data[i];
    p[k] = chk(p, k); k++;
    send(p, k);
    if (id != 0xFE) { uint8_t buf[16]; readPacket(buf, sizeof buf, 4, id); }   // status reply
}
void writeByte(uint8_t id, uint8_t reg, uint8_t v) { busWrite(id, reg, &v, 1); }
void writeWord(uint8_t id, uint8_t reg, uint16_t v) { uint8_t b[2] = {(uint8_t)(v & 0xFF), (uint8_t)(v >> 8)}; busWrite(id, reg, b, 2); }
void syncWrite(const uint8_t* ids, uint8_t count, uint8_t reg, const uint8_t* data, uint8_t n) {
    uint8_t p[96];
    int k = 0;
    p[k++] = 0xFF; p[k++] = 0xFF; p[k++] = 0xFE; p[k++] = (n + 1) * count + 4; p[k++] = INST_SYNC_WRITE; p[k++] = reg; p[k++] = n;
    for (uint8_t s = 0; s < count; s++) { p[k++] = ids[s]; for (uint8_t i = 0; i < n; i++) p[k++] = data[s * n + i]; }
    p[k] = chk(p, k); k++;
    send(p, k);
}
int busRead(uint8_t id, uint8_t reg, uint8_t n, uint8_t* out, uint32_t timeoutMs = 8) {
    uint8_t p[8] = {0xFF, 0xFF, id, 4, INST_READ, reg, n, 0};
    p[7] = chk(p, 7);
    send(p, 8);
    uint8_t buf[64];
    int got = readPacket(buf, sizeof buf, timeoutMs, id);
    if (got < 6) return 0;
    uint8_t plen = buf[3];   // = n + 2
    if (plen < 2 || plen - 2 != n || got < plen + 4) return 0;
    uint8_t c = 0;
    for (int i = 2; i < plen + 3; i++) c += buf[i];
    if ((uint8_t)~c != buf[plen + 3]) return 0;
    memcpy(out, buf + 5, n);
    return n;
}
bool readByte(uint8_t id, uint8_t reg, uint8_t& v) { return busRead(id, reg, 1, &v) == 1; }
bool ping(uint8_t id) {
    uint8_t p[6] = {0xFF, 0xFF, id, 2, INST_PING, 0};
    p[5] = chk(p, 5);
    send(p, 6);
    uint8_t buf[16];
    return readPacket(buf, sizeof buf, 8, id) >= 6;
}
Status status(uint8_t id) {
    Status st;
    uint8_t b[16];
    if (busRead(id, REG_PRESENT_POS, 8, b) != 8) return st;   // 56..63
    st.pos = (int16_t)(b[0] | (b[1] << 8));
    int16_t sp = b[2] | (b[3] << 8); st.speed = (sp & 0x8000) ? -(sp & 0x7FFF) : sp;
    int16_t ld = b[4] | (b[5] << 8); st.load = (ld & 0x0400) ? -(ld & 0x03FF) : ld;
    st.volt10 = b[6]; st.temp = b[7];
    if (busRead(id, REG_CURRENT, 2, b) == 2) { int16_t c = b[0] | (b[1] << 8); st.current = (c & 0x8000) ? -(c & 0x7FFF) : c; }
    st.ok = true;
    return st;
}
struct Lock {   // every bus transaction from any task goes through this
    Lock() { xSemaphoreTakeRecursive(busMtx, portMAX_DELAY); }
    ~Lock() { xSemaphoreGiveRecursive(busMtx); }
};
}  // namespace

// ---------------------------------------------------------------- joints
namespace servo {
struct JT_ { const char* name; uint8_t id; int8_t sign; float centre, lo, hi; };
#define X(n, i, s, c, lo, hi) {n, i, s, c, lo, hi},
static const JT_ JT[] = {JOINT_TABLE};
#undef X
enum { J_YAW = 0, J_SHOULDER, J_ELBOW, J_WRIST, J_ROLL };

static float target[NJ], sent[NJ];
static uint16_t speedV = DEFAULT_SPEED;
static uint8_t accV = DEFAULT_ACC;
static bool torqueV = false, floorBlockedV = false;
static Status jstat[NJ];
static bool online[NJ];
static std::string msgV;
static SemaphoreHandle_t stateMtx;   // target/sent/jstat/action state

static float clampJ(int j, float v) { return std::min(std::max(v, JT[j].lo), JT[j].hi); }
static int16_t toTicks(int j, float deg) {
    long t = 2048 + lroundf(JT[j].sign * (deg - JT[j].centre) * TICKS_PER_DEG);
    return (int16_t)std::min(std::max(t, 0L), 4095L);
}
static float toDeg(int j, int16_t ticks) { return JT[j].centre + JT[j].sign * (ticks - 2048) / TICKS_PER_DEG; }

// Lowest point of the shade rim above the desk for a pose (URDF degrees), from the CAD: shoulder pivot z 108,
// links 130, neck axis 75.3 + cup offset 5 from the wrist, mouth 89 along the head axis, rim radius 55.
static float headFloorMm(const float* q) {
    const float D = (float)M_PI / 180;
    float a1 = q[J_SHOULDER] * D, a2 = a1 + q[J_ELBOW] * D, a3 = a2 + q[J_WRIST] * D;
    float z = 108.0f + 130.0f * sinf(a1) + 130.0f * sinf(a2) + 80.3f * sinf(a3);
    return z - 89.0f * cosf(a3) - 55.0f;
}

// Move every joint to its target so they all arrive after `msArg` (0 = the global speed), one sync write. The servo
// ramps at `acc` (x100 ticks/s^2), so the speed is chosen for a trapezoid that ends at `msArg`. Returns the time the
// slowest joint really needs (ms). Caller holds stateMtx.
static uint32_t pushTargets(uint32_t msArg = 0, bool force = false, uint8_t accOverride = 0) {
    bool changed = force;
    for (int j = 0; j < NJ; j++) if (fabsf(target[j] - sent[j]) > 0.05f) changed = true;
    if (!changed || !torqueV) return 0;
    uint8_t data[NJ * 7], ids[NJ], n = 0;
    uint8_t a8 = accOverride ? accOverride : accV;
    float a = std::max((int)a8, 1) * 100.0f, need = 0;
    for (int j = 0; j < NJ; j++) {
        if (!online[j]) { sent[j] = target[j]; continue; }   // a missing servo must not keep "changed" true: 0.25 then repeated this write every tick, restarting the others' ramps
        int16_t p = toTicks(j, target[j]);
        uint16_t sp = speedV;
        float dist = fabsf(target[j] - sent[j]) * TICKS_PER_DEG;
        if (msArg > 0 && dist > 0.5f) {
            float t = msArg / 1000.0f, disc = t * t - 4 * dist / a;
            float v = disc >= 0 ? (t - sqrtf(disc)) * a / 2 : sqrtf(dist * a);
            sp = (uint16_t)std::min(std::max(v, 60.0f), 2500.0f);
            need = std::max(need, dist / sp + sp / a);
        }
        uint8_t* d = data + n * 7;
        d[0] = a8; d[1] = p & 0xFF; d[2] = p >> 8; d[3] = 0; d[4] = 0; d[5] = sp & 0xFF; d[6] = sp >> 8;
        ids[n++] = JT[j].id;
        sent[j] = target[j];
    }
    if (n) { Lock l; syncWrite(ids, n, REG_ACC, data, 7); }
    return (uint32_t)(need * 1000);
}

// Torque on takes over from wherever the arm is: fresh reading, goal = present position written before the switch,
// target = that reading without clamping. Nothing jumps. Caller holds stateMtx.
static void setTorqueLocked(bool on) {
    torqueV = on;
    Lock l;
    for (int j = 0; j < NJ; j++) {
        if (!online[j]) continue;
        if (on) {
            jstat[j] = status(JT[j].id);
            if (jstat[j].ok) { writeWord(JT[j].id, REG_GOAL_POS, (uint16_t)jstat[j].pos); target[j] = toDeg(j, jstat[j].pos); }
            sent[j] = target[j];
        }
        writeByte(JT[j].id, REG_TORQUE, on ? 1 : 0);
    }
}

// ---------------------------------------------------------------- actions: keyframes in URDF degrees
struct Cue { light::Mode mode; light::RGB c1; uint8_t spd, w; float eye, aim; };
struct Key { float q[5]; uint16_t ms; bool rel; uint8_t acc; const Cue* cue; };
struct Action { const char* name; const Key* keys; uint8_t n; bool keep, safe; };   // safe: the arm stands by itself there with the motors off (measured 2026-11-10, README 0.32)
static const light::RGB WARM = {255, 177, 92}, WHITE = {255, 235, 200}, RED = {255, 16, 0}, GREEN = {16, 255, 40}, SKY = {40, 160, 255},
                        GOLD = {255, 200, 40}, VIOLET = {170, 60, 255}, AMBER = {75, 35, 0}, DIM = {12, 5, 0}, CALM = {5, 75, 12};
static const Cue C_WARM = {light::SOLID, WARM, 40, 6, 1, 90}, C_DESK = {light::FOLLOW, WARM, 40, 14, 1, 180}, C_READ = {light::SOLID, WHITE, 40, 6, 1, 90},
                 C_SHUT = {light::EYE, WHITE, 100, 6, 0, 90}, C_OPEN = {light::EYE, WHITE, 30, 6, 1, 90}, C_AWAKE = {light::EYE, WHITE, 100, 6, 1, 90},
                 C_SCAN = {light::SCANNER, SKY, 60, 5, 1, 90}, C_SPIN = {light::RAINBOW, WARM, 80, 6, 1, 90}, C_HAPPY = {light::SPARKLE, GOLD, 90, 6, 1, 90},
                 C_NO = {light::SOLID, RED, 40, 6, 1, 90}, C_YES = {light::SOLID, GREEN, 40, 6, 1, 90}, C_PSHUT = {light::EYE, VIOLET, 100, 6, 0, 90},
                 C_PHALF = {light::EYE, VIOLET, 40, 6, 0.35f, 90}, C_PWIDE = {light::EYE, VIOLET, 60, 6, 1, 90}, C_WARN = {light::SOLID, AMBER, 40, 6, 1, 90},
                 C_WARN0 = {light::SOLID, DIM, 40, 6, 1, 90}, C_CALM = {light::SOLID, CALM, 40, 6, 1, 90};
#define _ NAN
#define HOLD _, _, _, _, _
// Safe poses (0.35): one keyframe, no light cue, the arm stays there and the light stays as it is. Head positions from the
// link lengths, loads from the hold survey: all three joints read 0 at the three shoulder-110 desk poses.
static const Key K_DESK[] = {{{DEFAULT_POSE}, DEFAULT_MS, false, 0, nullptr}};       // desk light, the default pose (0.36): head over the base at 404 mm, 50 deg down, spot 400 mm out
static const Key K_REST[] = {{{REST_POSE}, DEFAULT_MS, false, 0, nullptr}};          // folded back on itself, set by hand on the first lamp
static const Key K_CLOSE[] = {{{0, 110, -60, -30, 0}, 2000, false, 0, nullptr}};     // close work light: 70 deg down, spot 245 mm out
static const Key K_FAR[] = {{{0, 110, -60, 0, 0}, 2000, false, 0, nullptr}};         // far desk light: 40 deg down, spot 560 mm out
static const Key K_DOWN[] = {{{0, 110, -80, -30, 0}, 2000, false, 0, nullptr}};      // straight down at the base, head at 295 mm
static const Key K_AHEAD[] = {{{0, 80, 40, -30, 0}, 2000, false, 0, nullptr}};       // looking level ahead, head 429 mm high
static const Key K_CEILING[] = {{{0, 95, 0, 80, 0}, 2000, false, 0, nullptr}};       // ceiling bounce: 85 deg up
static const Key K_UP[] = {{{0, 90, 0, 0, 0}, 1500, false, 0, &C_WARM}};
static const Key K_LOOKDOWN[] = {{{0, 80, -70, 70, 0}, 2000, false, 0, &C_DESK}};
static const Key K_REACH[] = {{{0, 35, 40, -30, 0}, 2000, false, 0, &C_READ}};
static const Key K_WAKE[] = {{{0, 80, -70, 70, 0}, 2500, false, 0, &C_SHUT}, {{HOLD}, 1400, false, 0, &C_OPEN}, {{_, _, _, _, 35}, 900, false, 0, nullptr},
                             {{HOLD}, 500, false, 0, nullptr}, {{_, _, _, _, -35}, 1000, false, 0, nullptr}, {{HOLD}, 500, false, 0, nullptr},
                             {{_, _, _, _, 0}, 800, false, 0, nullptr}, {{HOLD}, 140, false, 0, &C_SHUT}, {{HOLD}, 700, false, 0, &C_AWAKE}};
static const Key K_SCAN[] = {{{-70, _, _, _, -20}, 1600, false, 0, &C_SCAN}, {{_, _, _, 60, _}, 500, false, 0, nullptr}, {{_, _, _, 70, _}, 500, false, 0, nullptr},
                             {{70, _, _, _, 20}, 2200, false, 0, nullptr}, {{_, _, _, 60, _}, 500, false, 0, nullptr}, {{_, _, _, 70, _}, 500, false, 0, nullptr},
                             {{0, _, _, _, 0}, 1400, false, 0, nullptr}};
static const Key K_SPIN[] = {{{0, 90, 0, 0, 0}, 1500, false, 0, &C_SPIN}, {{80, _, _, _, -80}, 1300, false, 0, nullptr}, {{-80, _, _, _, 80}, 2200, false, 0, nullptr},
                             {{0, _, _, _, 0}, 1300, false, 0, nullptr}};
static const Key K_BOUNCE[] = {{{_, 100, -15, _, _}, 300, false, 0, &C_HAPPY}, {{_, 80, 15, _, _}, 300, false, 0, nullptr}, {{_, 100, -15, _, _}, 300, false, 0, nullptr},
                               {{_, 80, 15, _, _}, 300, false, 0, nullptr}, {{0, 90, 0, 0, 0}, 500, false, 0, nullptr}};
static const Key K_NO[] = {{{-12, _, _, _, _}, 260, true, 150, &C_NO}, {{12, _, _, _, _}, 300, true, 150, nullptr}, {{-12, _, _, _, _}, 300, true, 150, nullptr},
                           {{12, _, _, _, _}, 300, true, 150, nullptr}, {{0, _, _, _, _}, 260, true, 150, nullptr}};
static const Key K_YES[] = {{{_, _, _, 15, _}, 280, true, 150, &C_YES}, {{_, _, _, -8, _}, 300, true, 150, nullptr}, {{_, _, _, 15, _}, 300, true, 150, nullptr},
                            {{_, _, _, -8, _}, 300, true, 150, nullptr}, {{_, _, _, 0, _}, 280, true, 150, nullptr}};
static const Key K_PEEK[] = {{{0, 100, -80, 90, 0}, 1800, false, 0, &C_PSHUT}, {{HOLD}, 800, false, 0, &C_PHALF}, {{-35, _, _, _, -30}, 700, false, 0, nullptr},
                             {{HOLD}, 600, false, 0, nullptr}, {{35, _, _, _, 30}, 900, false, 0, nullptr}, {{HOLD}, 600, false, 0, &C_PWIDE},
                             {{0, _, _, _, 0}, 800, false, 0, nullptr}, {{0, 90, 0, 0, 0}, 1200, false, 0, nullptr}};
static const Key K_WARNING[] = {{{0, 100, -20, 20, 0}, 600, false, 0, &C_WARN}, {{15, _, _, _, _}, 200, false, 150, &C_WARN0}, {{-15, _, _, _, _}, 200, false, 150, &C_WARN},
                                {{15, _, _, _, _}, 200, false, 150, &C_WARN0}, {{-15, _, _, _, _}, 200, false, 150, &C_WARN}, {{15, _, _, _, _}, 200, false, 150, &C_WARN0},
                                {{0, _, _, _, _}, 200, false, 150, &C_WARN}, {{HOLD}, 300, false, 150, &C_WARN0}, {{HOLD}, 300, false, 150, &C_WARN},
                                {{0, 90, 0, 0, 0}, 900, false, 0, nullptr}};
static const Key K_RESOLVED[] = {{{0, 95, -15, 15, 0}, 500, false, 0, &C_WARN}, {{0, 80, -30, 30, 0}, 1200, false, 0, &C_CALM}, {{HOLD}, 400, false, 0, nullptr},
                                 {{_, _, _, 42, _}, 350, false, 0, nullptr}, {{_, _, _, 30, _}, 350, false, 0, nullptr}, {{HOLD}, 300, false, 0, nullptr},
                                 {{0, 90, 0, 0, 0}, 1000, false, 0, nullptr}};
#undef HOLD
#undef _
#define A(n, k, keep, safe) {n, k, sizeof(k) / sizeof(k[0]), keep, safe}
static const Action ACTIONS[] = {A("desk", K_DESK, true, true), A("rest", K_REST, true, true), A("close", K_CLOSE, true, true), A("far", K_FAR, true, true),
                                 A("down", K_DOWN, true, true), A("ahead", K_AHEAD, true, true), A("ceiling", K_CEILING, true, true),
                                 A("up", K_UP, true, false), A("lookdown", K_LOOKDOWN, true, false), A("reach", K_REACH, true, false), A("wake", K_WAKE, false, false),
                                 A("scan", K_SCAN, false, false), A("spin", K_SPIN, false, false), A("bounce", K_BOUNCE, false, false), A("no", K_NO, false, false),
                                 A("yes", K_YES, false, false), A("peek", K_PEEK, false, false), A("warning", K_WARNING, false, false), A("resolved", K_RESOLVED, false, false)};
#undef A
static const int NACTIONS = sizeof(ACTIONS) / sizeof(ACTIONS[0]);
static const Action* act = nullptr;
static const Action* const DEFAULT = &ACTIONS[0];   // "desk": after every gesture, and before torque off from a pose that is not safe
static bool torqueOffPending = false;   // torque goes off once the default pose is reached
static void setTorqueLocked(bool on);
static Hold holdV = {};                 // the hold test (0.32): motors off where the arm is, watched, back on at the first drift
static int16_t holdStart[NJ];
static int64_t holdT0 = 0;
static const char* holdWhy = nullptr;   // why the last holdTest was refused
static char holdWhyBuf[120];
static int actKey = 0;
static int64_t actT0 = 0;
static uint32_t actMs = 0;
static float actBase[NJ];
static light::Params lightBefore;
static bool lightSaved = false;

static void applyCue(const Cue* c) {
    if (!c) return;
    light::Params p = light::get();
    p.mode = c->mode; p.c1 = c->c1; p.spd = c->spd; p.w = c->w; p.eye = c->eye; p.aim = c->aim;
    light::set(p);
}
static void endAction() {   // finished, stopped, replaced or blocked: bring the light back (not after a work-light pose)
    if (act && !act->keep && lightSaved) {
        light::Params p = light::get();
        const light::Params& b = lightBefore;
        p.mode = b.mode; p.c1 = b.c1; p.c2 = b.c2; p.spd = b.spd; p.w = b.w; p.eye = b.eye; p.aim = b.aim;
        light::set(p);
    }
    act = nullptr;
    lightSaved = false;
}
static void applyKey() {
    const Key& k = act->keys[actKey];
    float q[NJ];
    for (int j = 0; j < NJ; j++) q[j] = std::isnan(k.q[j]) ? target[j] : clampJ(j, k.rel ? actBase[j] + k.q[j] : k.q[j]);
    if (headFloorMm(q) < FLOOR_MM) { floorBlockedV = true; endAction(); torqueOffPending = false; return; }
    for (int j = 0; j < NJ; j++) target[j] = q[j];
    applyCue(k.cue);
    uint32_t need = pushTargets(k.ms, true, k.acc);
    actMs = need > k.ms ? need + 60 : k.ms;
}
static void startActionLocked(const Action* a) {
    if (act) endAction();
    torqueOffPending = false;              // a new wish cancels a pending torque off (setTorque sets it again after this)
    lightBefore = light::get();
    lightSaved = true;
    act = a; actKey = 0; actT0 = ms(); floorBlockedV = false;
    for (int j = 0; j < NJ; j++) actBase[j] = target[j];
    applyKey();
}
static void tickAction() {
    if (!act) return;
    if (ms() - actT0 < actMs) return;
    actKey++;
    actT0 = ms();
    if (actKey >= act->n) {                // finished: a gesture is followed by the default pose; a pending torque off happens there
        bool gesture = !act->keep, wasDefault = act == DEFAULT;
        endAction();
        if (wasDefault && torqueOffPending) { torqueOffPending = false; setTorqueLocked(false); ESP_LOGI(TAG, "default pose reached, torque off"); }
        else if (gesture) startActionLocked(DEFAULT);
        return;
    }
    applyKey();
}

// Hold test tick: fresh jstat, caller holds stateMtx. Drift of every joint since the motors went off; the first joint
// past maxDeg, or the time running out, ends the test and the motors come back on where the arm is now.
static void tickHold() {
    int trip = -1;
    for (int j = 0; j < NJ; j++) {
        if (!online[j] || !jstat[j].ok) continue;
        holdV.drift[j] = JT[j].sign * (jstat[j].pos - holdStart[j]) / TICKS_PER_DEG;
        if (trip < 0 && fabsf(holdV.drift[j]) > holdV.maxDeg) trip = j;
    }
    holdV.ms = (uint32_t)(ms() - holdT0);
    if (trip < 0 && holdV.ms < holdV.wantMs) return;
    holdV.running = false; holdV.done = true; holdV.tripped = trip;
    setTorqueLocked(true);
    if (trip < 0) ESP_LOGI(TAG, "hold test: held %u ms, motors on again", (unsigned)holdV.ms);
    else ESP_LOGI(TAG, "hold test: %s moved %.1f deg after %u ms, motors on again", JT[trip].name, holdV.drift[trip], (unsigned)holdV.ms);
}
static void cancelHold() {   // a torque switch during the test: the test is over, whoever switched decides the motors
    if (!holdV.running) return;
    holdV.running = false; holdV.done = true; holdV.tripped = -2;
    holdV.ms = (uint32_t)(ms() - holdT0);
}

// ---------------------------------------------------------------- motion task: 50 Hz actions + targets, 10 Hz telemetry
static void taskFn(void*) {
    TickType_t last = xTaskGetTickCount();
    int64_t lastTele = 0;
    while (true) {
        vTaskDelayUntil(&last, pdMS_TO_TICKS(20));
        xSemaphoreTake(stateMtx, portMAX_DELAY);
        tickAction();
        pushTargets();
        if (holdV.running || ms() - lastTele >= TELEMETRY_MS) {   // every tick during a hold test (about 12 ms of bus time)
            lastTele = ms();
            Lock l;
            for (int j = 0; j < NJ; j++) if (online[j]) jstat[j] = status(JT[j].id);
            if (holdV.running) tickHold();
        }
        // motion for the reactive light: measured speed plus the distance still to go; direction from yaw and roll
        float m = 0, dir = 0;
        for (int j = 0; j < NJ; j++) {
            if (!online[j] || !jstat[j].ok) continue;
            float v = JT[j].sign * jstat[j].speed / TICKS_PER_DEG;
            float togo = torqueV ? fabsf(target[j] - toDeg(j, jstat[j].pos)) : 0;
            m += fabsf(v) / 60.0f + togo / 25.0f;
            if (j == J_YAW) dir += v; else if (j == J_ROLL) dir += LED_ROLL_SIGN * v;
        }
        float roll = online[J_ROLL] && jstat[J_ROLL].ok ? toDeg(J_ROLL, jstat[J_ROLL].pos) : target[J_ROLL];
        xSemaphoreGive(stateMtx);
        light::setMotion(std::min(m, 1.0f), dir, roll);
    }
}

// ---------------------------------------------------------------- public
bool begin() {
    busMtx = xSemaphoreCreateRecursiveMutex();
    stateMtx = xSemaphoreCreateRecursiveMutex();
    uart_config_t uc = {};
    uc.baud_rate = BUS_BAUD;
    uc.data_bits = UART_DATA_8_BITS;
    uc.parity = UART_PARITY_DISABLE;
    uc.stop_bits = UART_STOP_BITS_1;
    uc.flow_ctrl = UART_HW_FLOWCTRL_DISABLE;
    uc.source_clk = UART_SCLK_DEFAULT;
    ESP_ERROR_CHECK(uart_driver_install(BUS_UART, 512, 0, 0, nullptr, 0));
    ESP_ERROR_CHECK(uart_param_config(BUS_UART, &uc));
    ESP_ERROR_CHECK(uart_set_pin(BUS_UART, BUS_TX, BUS_RX, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE));

    // Boot: find the servos and read where they are. No goal position is written; the torque switch is read as found,
    // then the last commanded state from flash is restored through the no-jump takeover. A servo left in wheel mode is
    // put back in position mode (EEPROM write, no motion).
    bool anyOn = false;
    int found = 0;
    {
        Lock l;
        // Does the adapter echo what we send? A read addressed to id 253 (nobody) gets no reply, so whatever comes back
        // in 5 ms is our own packet. Only then is a reply identical to our packet dropped as an echo: a servo answering
        // a ping with the voltage-error bit set sends back exactly the ping's bytes, and 0.25 lost it as "NOT FOUND".
        uint8_t probe[8] = {0xFF, 0xFF, 0xFD, 4, INST_READ, REG_PRESENT_POS, 2, 0}, back[16];
        probe[7] = chk(probe, 7);
        send(probe, 8);
        int got = uart_read_bytes(BUS_UART, back, sizeof back, pdMS_TO_TICKS(5));
        echoes = got == txn && memcmp(back, txbuf, txn) == 0;
        ESP_LOGI(TAG, "bus adapter %s", echoes ? "echoes" : "does not echo");
        for (int j = 0; j < NJ; j++) {
            online[j] = ping(JT[j].id);
            if (online[j]) {
                found++;
                uint8_t m = 0xFF, t = 0;
                if (readByte(JT[j].id, REG_MODE, m) && m != 0) {
                    writeByte(JT[j].id, REG_LOCK, 0); sleepMs(5); writeByte(JT[j].id, REG_MODE, 0); sleepMs(5); writeByte(JT[j].id, REG_LOCK, 1); sleepMs(5);
                }
                if (readByte(JT[j].id, REG_TORQUE, t) && t == 1) anyOn = true;
                jstat[j] = status(JT[j].id);
                target[j] = jstat[j].ok ? toDeg(j, jstat[j].pos) : JT[j].centre;
            } else target[j] = JT[j].centre;
            sent[j] = target[j];
            if (online[j] && jstat[j].ok) ESP_LOGI(TAG, "%-9s id %d: ok  %d ticks = %.1f deg", JT[j].name, JT[j].id, jstat[j].pos, target[j]);
            else ESP_LOGW(TAG, "%-9s id %d: %s", JT[j].name, JT[j].id, online[j] ? "no status" : "NOT FOUND");
        }
    }
    torqueV = anyOn;
    ESP_LOGI(TAG, "%d of %d servos on the bus, torque %s at boot (as found)", found, NJ, torqueV ? "ON" : "off");
    nvs_handle_t h;
    uint8_t want = 0;
    if (nvs_open("lamp", NVS_READONLY, &h) == ESP_OK) { nvs_get_u8(h, "torque", &want); nvs_close(h); }
    if (want && !torqueV && found) { setTorqueLocked(true); ESP_LOGI(TAG, "torque ON (restored from flash, holding the pose as found)"); }
    xTaskCreatePinnedToCore(taskFn, "motion", 4096, nullptr, 3, nullptr, 0);
    return found > 0;
}

Joint joint(int j) {
    Joint o = {};
    if (j < 0 || j >= NJ) return o;
    xSemaphoreTake(stateMtx, portMAX_DELAY);
    o.name = JT[j].name; o.id = JT[j].id; o.online = online[j]; o.ok = online[j] && jstat[j].ok;
    o.target = target[j]; o.deg = o.ok ? toDeg(j, jstat[j].pos) : 0; o.ticks = jstat[j].pos; o.load = jstat[j].load;
    o.temp = jstat[j].temp; o.volt = jstat[j].volt10 / 10.0f; o.mA = (int)(jstat[j].current * 6.5f); o.lo = JT[j].lo; o.hi = JT[j].hi;
    xSemaphoreGive(stateMtx);
    return o;
}
int jointIndex(const char* n) { for (int j = 0; j < NJ; j++) if (strcmp(JT[j].name, n) == 0) return j; return -1; }
bool torque() { return torqueV; }
// The arm stands in one of the safe poses: every joint of that pose except yaw (gravity does not care about the base
// turn) within 1 deg of the target and the servo within 2 deg of it (settled). Caller holds stateMtx.
static bool inSafePoseLocked() {
    for (int i = 0; i < NACTIONS; i++) {
        if (!ACTIONS[i].safe) continue;
        const float* q = ACTIONS[i].keys[0].q;
        bool match = true;
        for (int j = 0; j < NJ && match; j++) {
            if (j == J_YAW || std::isnan(q[j])) continue;
            if (fabsf(target[j] - q[j]) > 1.0f) match = false;
            else if (online[j] && jstat[j].ok && fabsf(toDeg(j, jstat[j].pos) - target[j]) > 2.0f) match = false;
        }
        if (match) return true;
    }
    return false;
}
bool inSafePose() {
    xSemaphoreTake(stateMtx, portMAX_DELAY);
    bool r = inSafePoseLocked();
    xSemaphoreGive(stateMtx);
    return r;
}
void setTorque(bool on) {
    xSemaphoreTake(stateMtx, portMAX_DELAY);
    cancelHold();
    bool anyOnline = false;
    for (int j = 0; j < NJ; j++) anyOnline |= online[j];
    if (!on && torqueV && anyOnline && inSafePoseLocked()) {   // already standing in a safe pose: off where it is (0.35)
        endAction();
        torqueOffPending = false;
        setTorqueLocked(false);
        ESP_LOGI(TAG, "torque off where the arm is: a safe pose");
    } else if (!on && torqueV && anyOnline) {   // first the default pose, so the arm keeps standing without power; off when it is reached
        startActionLocked(DEFAULT);
        if (act == DEFAULT) torqueOffPending = true;
        else setTorqueLocked(false);       // the default pose was refused (floor check): off where it is
    } else {
        torqueOffPending = false;          // "on" during the move to the default pose: stay on (0.26 still switched off when the pose was reached)
        setTorqueLocked(on);
    }
    xSemaphoreGive(stateMtx);
    nvs_handle_t h;
    if (nvs_open("lamp", NVS_READWRITE, &h) == ESP_OK) { nvs_set_u8(h, "torque", on ? 1 : 0); nvs_commit(h); nvs_close(h); }
}
int speed() { return speedV; }
int acc() { return accV; }
void setSpeedAcc(int sp, int ac) {
    if (sp >= 0) speedV = (uint16_t)std::min(std::max(sp, 50), 3400);
    if (ac >= 0) accV = (uint8_t)std::min(std::max(ac, 1), 254);
}
bool setPose(const float* qIn, const bool* has) {
    xSemaphoreTake(stateMtx, portMAX_DELAY);
    float q[NJ];
    bool any = false;
    for (int j = 0; j < NJ; j++) { q[j] = target[j]; if (has[j]) { q[j] = clampJ(j, qIn[j]); any = true; } }
    bool okv = true;
    if (any) {
        endAction();
        torqueOffPending = false;          // a slider move cancels a pending torque off, as a new action does (0.26 kept it armed: off after the next gesture)
        floorBlockedV = headFloorMm(q) < FLOOR_MM;
        if (!floorBlockedV) for (int j = 0; j < NJ; j++) target[j] = q[j];
        okv = !floorBlockedV;
    }
    xSemaphoreGive(stateMtx);
    return okv;
}
bool floorBlocked() { return floorBlockedV; }
const char* action() { return act ? act->name : ""; }
bool startAction(const char* name) {
    xSemaphoreTake(stateMtx, portMAX_DELAY);
    bool r = true;
    if (!name || !*name) { endAction(); torqueOffPending = false; }
    else {
        r = false;
        for (int i = 0; i < NACTIONS; i++) if (strcmp(ACTIONS[i].name, name) == 0) { startActionLocked(&ACTIONS[i]); r = true; break; }
    }
    xSemaphoreGive(stateMtx);
    return r;
}
int actionCount() { return NACTIONS; }
const char* actionName(int i) { return i >= 0 && i < NACTIONS ? ACTIONS[i].name : ""; }
bool actionSafe(int i) { return i >= 0 && i < NACTIONS && ACTIONS[i].safe; }
void actionPose(int i, float* q) {
    for (int j = 0; j < NJ; j++) q[j] = i >= 0 && i < NACTIONS ? ACTIONS[i].keys[0].q[j] : NAN;
}

// Hold test: see servo.h. Start positions are read fresh with the motors still on, then the torque registers go off.
bool holdTest(float maxDeg, uint32_t wantMs) {
    xSemaphoreTake(stateMtx, portMAX_DELAY);
    holdWhy = nullptr;
    if (!torqueV) holdWhy = "the motors are off";
    else if (act) holdWhy = "a gesture is running";
    else if (holdV.running) holdWhy = "a hold test is running";
    else {
        float q[NJ];
        for (int j = 0; j < NJ; j++) q[j] = online[j] && jstat[j].ok ? toDeg(j, jstat[j].pos) : target[j];
        if (headFloorMm(q) < HOLD_FLOOR_MM) holdWhy = "the shade is closer than 40 mm to the desk";
        else if (online[J_SHOULDER] && jstat[J_SHOULDER].ok && abs(jstat[J_SHOULDER].load) > HOLD_MAX_LOAD) {
            snprintf(holdWhyBuf, sizeof holdWhyBuf, "the shoulder already works at a load of %d (limit %d): this pose falls with the motors off, no need to try", (int)jstat[J_SHOULDER].load, HOLD_MAX_LOAD);
            holdWhy = holdWhyBuf;
        }
    }
    bool okv = holdWhy == nullptr;
    if (okv) {
        holdV = {};
        holdV.running = true;
        holdV.maxDeg = std::min(std::max(maxDeg, 0.3f), HOLD_MAX_DEG);
        holdV.wantMs = std::min(std::max(wantMs, (uint32_t)500), (uint32_t)HOLD_MAX_MS);
        Lock l;
        for (int j = 0; j < NJ; j++) {
            if (!online[j]) continue;
            jstat[j] = status(JT[j].id);
            holdStart[j] = jstat[j].pos;
        }
        holdT0 = ms();
        setTorqueLocked(false);
        ESP_LOGI(TAG, "hold test: motors off where the arm is, %u ms, trip at %.1f deg", (unsigned)holdV.wantMs, holdV.maxDeg);
    }
    xSemaphoreGive(stateMtx);
    return okv;
}
Hold hold() {
    xSemaphoreTake(stateMtx, portMAX_DELAY);
    Hold h = holdV;
    xSemaphoreGive(stateMtx);
    return h;
}
const char* holdRefusal() { return holdWhy ? holdWhy : ""; }

// Make the current position of a servo read 2048: torque register = 128 stores the correction in EEPROM (reg 31).
bool calibrate(int j) {
    if (j < 0 || j >= NJ || !online[j]) return false;
    xSemaphoreTake(stateMtx, portMAX_DELAY);
    if (torqueV) {   // torque back on afterwards would send the servo to its old goal, which is a different angle now: a jump
        if (msgV.empty()) msgV = "init pose not stored: switch torque off first";
        xSemaphoreGive(stateMtx);
        return false;
    }
    Lock l;
    writeByte(JT[j].id, REG_TORQUE, 0); sleepMs(10);
    writeByte(JT[j].id, REG_LOCK, 0); sleepMs(10);
    writeByte(JT[j].id, REG_TORQUE, 128); sleepMs(60);
    writeByte(JT[j].id, REG_LOCK, 1); sleepMs(10);
    uint8_t b[2];
    bool okv = busRead(JT[j].id, REG_PRESENT_POS, 2, b) == 2 && abs((int)(b[0] | (b[1] << 8)) - 2048) < 4;
    writeByte(JT[j].id, REG_TORQUE, torqueV ? 1 : 0);
    if (okv) { target[j] = JT[j].centre; sent[j] = target[j]; }   // the servo already sits at 2048: nothing to push
    msgV += std::string(msgV.empty() ? "init pose stored:" : "") + " " + JT[j].name + (okv ? " ok" : " FAILED");
    xSemaphoreGive(stateMtx);
    return okv;
}
std::string lastMsg() { std::string s = msgV; msgV.clear(); return s; }

}  // namespace servo
