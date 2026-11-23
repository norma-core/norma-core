// NC lamp head controller: ESP32-CAM drives 5x ST3215 (position mode) over the Waveshare bus adapter and a
// WS2812 ring in the shade. Browser page with sliders, actions and light effects over a WebSocket, REST API for
// scripts, OTA updates. Joint angles follow the URDF (shoulder 90 = pointing up); 2048 ticks is the init pose.
// Boot never moves a servo: it only reads them and leaves the torque switch as it is. A freshly assembled lamp
// (horns seated anywhere) is set up from the page: torque off, pose it pointing up by hand, "Set this pose as
// init" (writes the servo offsets), torque on.
#include <Arduino.h>
#include <WiFi.h>
#include <ESPmDNS.h>
#include <ArduinoOTA.h>
#include <ESPAsyncWebServer.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include "config.h"
#include "feetech.h"
#include "leds.h"
#include "web_page.h"

static feetech::Bus bus(Serial2);
static volatile bool diagBusy = false;
static AsyncWebServer server(80);
static AsyncWebSocket ws("/ws");
static leds::Ring ring;
static Preferences prefs;                 // settings that survive a reboot (NVS): white balance
static uint32_t ctDirty = 0;              // millis of the last white balance change not yet saved

// ---------------------------------------------------------------- joints
struct Joint { const char* name; uint8_t id; int8_t sign; float centre, lo, hi; };
#define X(n, i, s, c, lo, hi) { n, i, s, c, lo, hi },
static const Joint JT[] = { JOINT_TABLE };
#undef X
static const int NJ = sizeof(JT) / sizeof(JT[0]);
enum { J_YAW = 0, J_SHOULDER, J_ELBOW, J_WRIST, J_ROLL };

static float target[NJ];                 // commanded angle (deg, URDF)
static float sent[NJ];                   // last angle written to the bus
static uint16_t speed = DEFAULT_SPEED;
static uint8_t acc = DEFAULT_ACC;
static bool torque = false, floorBlocked = false;
static feetech::Status jstat[NJ];
static bool online[NJ];
static String lastMsg;

static float clampJ(int j, float v) { return constrain(v, JT[j].lo, JT[j].hi); }
static int16_t toTicks(int j, float deg) { return (int16_t)constrain(2048 + lroundf(JT[j].sign * (deg - JT[j].centre) * TICKS_PER_DEG), 0, 4095); }
static float toDeg(int j, int16_t ticks) { return JT[j].centre + JT[j].sign * (ticks - 2048) / TICKS_PER_DEG; }
static int jointIndex(const char* n) { for (int j = 0; j < NJ; j++) if (strcmp(JT[j].name, n) == 0) return j; return -1; }

// Lowest point of the shade rim above the desk for a pose (URDF degrees), from the CAD: shoulder pivot z 108,
// links 130, neck axis 75.3 + cup offset 5 from the wrist, mouth 89 along the head axis (-v of the neck), rim radius 55.
static float headFloorMm(const float* q) {
  float a1 = q[J_SHOULDER] * DEG_TO_RAD, a2 = a1 + q[J_ELBOW] * DEG_TO_RAD, a3 = a2 + q[J_WRIST] * DEG_TO_RAD;
  float z = 108.0f + 130.0f * sinf(a1) + 130.0f * sinf(a2) + 80.3f * sinf(a3);
  return z - 89.0f * cosf(a3) - 55.0f;
}

// Move every joint to its target so they all arrive after `ms` (0 = use the global speed), one sync write.
// The servo ramps up and down at `acc` (x100 ticks/s^2), so the speed is chosen for a trapezoid profile that
// ends exactly at `ms`; when even full speed cannot make it, the fastest profile is used. Returns the time the
// slowest joint really needs (ms), so an action can hold the key that long.
static uint32_t pushTargets(uint32_t ms = 0, bool force = false, uint8_t accOverride = 0) {
  bool changed = force;
  for (int j = 0; j < NJ; j++) if (fabsf(target[j] - sent[j]) > 0.05f) changed = true;
  if (!changed || !torque) return 0;
  uint8_t data[NJ * 7], ids[NJ], n = 0;
  uint8_t a8 = accOverride ? accOverride : acc; float a = max((int)a8, 1) * 100.0f;
  float need = 0;
  for (int j = 0; j < NJ; j++) {
    if (!online[j]) continue;
    int16_t p = toTicks(j, target[j]);
    uint16_t sp = speed;
    float dist = fabsf(target[j] - sent[j]) * TICKS_PER_DEG;
    if (ms > 0 && dist > 0.5f) {
      float t = ms / 1000.0f, disc = t * t - 4 * dist / a;
      float v = disc >= 0 ? (t - sqrtf(disc)) * a / 2 : sqrtf(dist * a);
      sp = (uint16_t)constrain(v, 60.0f, 2500.0f);
      need = max(need, dist / sp + sp / a);
    }
    uint8_t* d = data + n * 7;
    d[0] = a8; d[1] = p & 0xFF; d[2] = p >> 8; d[3] = 0; d[4] = 0; d[5] = sp & 0xFF; d[6] = sp >> 8;
    ids[n++] = JT[j].id; sent[j] = target[j];
  }
  if (n) bus.syncWrite(ids, n, feetech::REG_ACC, data, 7);
  return (uint32_t)(need * 1000);
}

// Torque on takes over from wherever the arm is: fresh reading, goal = present position written before the
// switch, target = that reading without clamping. Nothing jumps, even if the arm was moved by hand or the
// servos are not centred yet. The joint limits apply to the next commanded move, not to this takeover.
static void setTorque(bool on) {
  torque = on;
  for (int j = 0; j < NJ; j++) {
    if (!online[j]) continue;
    if (on) {
      jstat[j] = bus.status(JT[j].id);
      if (jstat[j].ok) { bus.writeWord(JT[j].id, feetech::REG_GOAL_POS, (uint16_t)jstat[j].pos); target[j] = toDeg(j, jstat[j].pos); }
      sent[j] = target[j];
    }
    bus.writeByte(JT[j].id, feetech::REG_TORQUE, on ? 1 : 0);
  }
}

// Boot: find the servos and read where they are. No goal position is written and the torque switch is left as
// it is (off after a servo power-up, unchanged after an OTA reboot), so a lamp whose horns sit differently
// from the calibrated one cannot jump into a wrong pose. Only a servo left in wheel mode is put back in
// position mode (EEPROM write, no motion).
static void initServos() {
  bool anyOn = false;
  for (int j = 0; j < NJ; j++) {
    online[j] = bus.ping(JT[j].id);
    if (online[j]) {
      uint8_t m = 0xFF, t = 0;
      if (bus.readByte(JT[j].id, feetech::REG_MODE, m) && m != 0) {
        bus.unlock(JT[j].id); delay(5); bus.writeByte(JT[j].id, feetech::REG_MODE, 0); delay(5); bus.lock(JT[j].id); delay(5);
      }
      if (bus.readByte(JT[j].id, feetech::REG_TORQUE, t) && t == 1) anyOn = true;
      jstat[j] = bus.status(JT[j].id);
      target[j] = jstat[j].ok ? toDeg(j, jstat[j].pos) : JT[j].centre;
    } else target[j] = JT[j].centre;
    sent[j] = target[j];
    Serial.printf("%-9s id %d: %s", JT[j].name, JT[j].id, online[j] ? "ok" : "NOT FOUND");
    if (online[j] && jstat[j].ok) Serial.printf("  %d ticks = %.1f deg", jstat[j].pos, target[j]);
    Serial.println();
  }
  torque = anyOn;
  Serial.printf("torque %s at boot (left as found)\n", torque ? "ON" : "off");
}

// Make the current position of a servo read 2048: torque register = 128 stores the correction in EEPROM (reg 31).
static bool recenter(int j) {
  if (!online[j]) return false;
  bus.writeByte(JT[j].id, feetech::REG_TORQUE, 0); delay(10);
  bus.unlock(JT[j].id); delay(10);
  bus.writeByte(JT[j].id, feetech::REG_TORQUE, 128); delay(60);
  bus.lock(JT[j].id); delay(10);
  uint8_t b[2]; bool ok = bus.read(JT[j].id, feetech::REG_PRESENT_POS, 2, b) == 2 && abs((int)(b[0] | (b[1] << 8)) - 2048) < 4;
  bus.writeByte(JT[j].id, feetech::REG_TORQUE, torque ? 1 : 0);
  if (ok) { target[j] = JT[j].centre; sent[j] = target[j]; }     // no push: the servo already sits at 2048
  return ok;
}

// ---------------------------------------------------------------- actions: keyframes in URDF degrees
// Each step: the joints it moves (NAN = keep) and the time to get there, all joints arriving together.
// rel = offsets from the pose the action started in (gestures that work from any pose); acc 0 = the global setting.
#define _ NAN
struct Key { float q[5]; uint16_t ms; bool rel; uint8_t acc; };
struct Action { const char* name; const Key* keys; uint8_t n; };
static const Key K_UP[]       = { {{0, 90, 0, 0, 0}, 1500} };
static const Key K_LOOKDOWN[] = { {{0, 80, -70, 70, 0}, 2000} };
static const Key K_REACH[]    = { {{0, 35, 40, -30, 0}, 2000} };
static const Key K_WAKE[]     = { {{0, 80, -70, 70, 0}, 2500}, {{_, _, _, _, _}, 600}, {{_, _, _, _, 35}, 900}, {{_, _, _, _, _}, 500}, {{_, _, _, _, -35}, 1000}, {{_, _, _, _, _}, 500}, {{_, _, _, _, 0}, 800} };
static const Key K_SCAN[]     = { {{-70, _, _, _, -20}, 1600}, {{_, _, _, 60, _}, 500}, {{_, _, _, 70, _}, 500}, {{70, _, _, _, 20}, 2200}, {{_, _, _, 60, _}, 500}, {{_, _, _, 70, _}, 500}, {{0, _, _, _, 0}, 1400} };
static const Key K_SPIN[]     = { {{0, 90, 0, 0, 0}, 1500}, {{90, _, _, _, -60}, 1300}, {{-90, _, _, _, 60}, 2200}, {{0, _, _, _, 0}, 1300} };
static const Key K_BOUNCE[]   = { {{_, 100, -15, _, _}, 300}, {{_, 80, 15, _, _}, 300}, {{_, 100, -15, _, _}, 300}, {{_, 80, 15, _, _}, 300}, {{0, 90, 0, 0, 0}, 500} };
// no: shake the head sideways = yaw, relative to the current pose. yes: nod = wrist pitch, down first (+ = towards the desk).
#define R true, 150
static const Key K_NO[]       = { {{-12, _, _, _, _}, 260, R}, {{12, _, _, _, _}, 300, R}, {{-12, _, _, _, _}, 300, R}, {{12, _, _, _, _}, 300, R}, {{0, _, _, _, _}, 260, R} };
static const Key K_YES[]      = { {{_, _, _, 15, _}, 280, R}, {{_, _, _, -8, _}, 300, R}, {{_, _, _, 15, _}, 300, R}, {{_, _, _, -8, _}, 300, R}, {{_, _, _, 0, _}, 280, R} };
#undef R
static const Key K_PEEK[]     = { {{0, 100, -80, 90, 0}, 1800}, {{_, _, _, _, _}, 800}, {{-35, _, _, _, -30}, 700}, {{_, _, _, _, _}, 600}, {{35, _, _, _, 30}, 900}, {{_, _, _, _, _}, 600}, {{0, _, _, _, 0}, 800}, {{0, 90, 0, 0, 0}, 1200} };
#undef _
#define A(n, k) { n, k, sizeof(k) / sizeof(k[0]) }
static const Action ACTIONS[] = { A("up", K_UP), A("lookdown", K_LOOKDOWN), A("reach", K_REACH), A("wake", K_WAKE), A("scan", K_SCAN),
                                  A("spin", K_SPIN), A("bounce", K_BOUNCE), A("no", K_NO), A("yes", K_YES), A("peek", K_PEEK) };
#undef A
static const int NACTIONS = sizeof(ACTIONS) / sizeof(ACTIONS[0]);
static int actIdx = -1, actKey = 0;
static uint32_t actT0 = 0, actMs = 0;    // start and length of the current key (its ms, or longer if the servos need it)
static float actBase[NJ];   // pose when the action started, for relative keys

static void applyKey() {
  const Key& k = ACTIONS[actIdx].keys[actKey];
  float q[NJ];
  for (int j = 0; j < NJ; j++) q[j] = isnan(k.q[j]) ? target[j] : clampJ(j, k.rel ? actBase[j] + k.q[j] : k.q[j]);
  if (headFloorMm(q) < FLOOR_MM) { floorBlocked = true; actIdx = -1; return; }
  for (int j = 0; j < NJ; j++) target[j] = q[j];
  uint32_t need = pushTargets(k.ms, true, k.acc);
  actMs = need > k.ms ? need + 60 : k.ms;
}
static bool startAction(const char* name) {
  if (!name || !*name) { actIdx = -1; return true; }
  for (int i = 0; i < NACTIONS; i++) if (strcmp(ACTIONS[i].name, name) == 0) { actIdx = i; actKey = 0; actT0 = millis(); floorBlocked = false; for (int j = 0; j < NJ; j++) actBase[j] = target[j]; applyKey(); return true; }
  return false;
}
static void tickAction() {
  if (actIdx < 0) return;
  if (millis() - actT0 < actMs) return;
  actKey++; actT0 = millis();
  if (actKey >= ACTIONS[actIdx].n) { actIdx = -1; return; }
  applyKey();
}

// ---------------------------------------------------------------- JSON in / out
static bool apMode = false;
static String ipStr, ssidStr;

static String hexColor(leds::RGB c) { char b[8]; snprintf(b, sizeof b, "#%02x%02x%02x", (int)c.r, (int)c.g, (int)c.b); return b; }
static bool parseColor(const char* s, leds::RGB& c) {
  if (!s || s[0] != '#' || strlen(s) != 7) return false;
  long v = strtol(s + 1, nullptr, 16); c = { (float)((v >> 16) & 255), (float)((v >> 8) & 255), (float)(v & 255) }; return true;
}

static String statusJson(bool withFrame) {
  JsonDocument d;
  d["up"] = millis() / 1000; d["heap"] = ESP.getFreeHeap(); d["torque"] = torque; d["speed"] = speed; d["acc"] = acc;
  d["action"] = actIdx >= 0 ? ACTIONS[actIdx].name : ""; d["floorBlocked"] = floorBlocked;
  if (lastMsg.length()) { d["msg"] = lastMsg; }
  JsonObject w = d["wifi"].to<JsonObject>(); w["ap"] = apMode; w["ssid"] = ssidStr; w["ip"] = ipStr; w["rssi"] = apMode ? 0 : WiFi.RSSI();
  JsonObject l = d["led"].to<JsonObject>();
  l["mode"] = ring.modeName(); l["color"] = hexColor(ring.p.c1); l["color2"] = hexColor(ring.p.c2); l["bri"] = ring.p.bri; l["spd"] = ring.p.spd; l["w"] = ring.p.w; l["aim"] = (int)ring.p.aim; l["ct"] = ring.p.ct; l["n"] = LED_COUNT;
  JsonArray js = d["joints"].to<JsonArray>();
  for (int j = 0; j < NJ; j++) {
    JsonObject o = js.add<JsonObject>();
    bool ok = online[j] && jstat[j].ok;
    o["name"] = JT[j].name; o["id"] = JT[j].id; o["ok"] = ok; o["target"] = target[j];
    o["deg"] = ok ? toDeg(j, jstat[j].pos) : 0; o["ticks"] = jstat[j].pos; o["load"] = jstat[j].load; o["temp"] = jstat[j].temp;
    o["v"] = jstat[j].volt10 / 10.0f; o["mA"] = (int)(jstat[j].current * 6.5f); o["min"] = JT[j].lo; o["max"] = JT[j].hi;
  }
  if (withFrame) {
    static char hexbuf[LED_COUNT * 6 + 1];
    for (int i = 0; i < LED_COUNT * 3; i++) { hexbuf[i * 2] = "0123456789abcdef"[ring.frame[i] >> 4]; hexbuf[i * 2 + 1] = "0123456789abcdef"[ring.frame[i] & 15]; }
    hexbuf[LED_COUNT * 6] = 0; d["leds"] = hexbuf;
  }
  String s; serializeJson(d, s); return s;
}

static void applyPose(JsonVariantConst v) {
  float q[NJ]; bool any = false;
  for (int j = 0; j < NJ; j++) { q[j] = target[j]; if (v[JT[j].name].is<float>()) { q[j] = clampJ(j, v[JT[j].name].as<float>()); any = true; } }
  if (v["speed"].is<int>()) speed = constrain(v["speed"].as<int>(), 50, 3400);
  if (v["acc"].is<int>()) acc = constrain(v["acc"].as<int>(), 1, 254);
  if (!any) return;
  actIdx = -1;
  floorBlocked = headFloorMm(q) < FLOOR_MM;
  if (!floorBlocked) for (int j = 0; j < NJ; j++) target[j] = q[j];
}
static void applyLed(JsonVariantConst v) {
  if (v["mode"].is<const char*>()) ring.setMode(v["mode"].as<const char*>());
  if (v["color"].is<const char*>()) parseColor(v["color"].as<const char*>(), ring.p.c1);
  if (v["color2"].is<const char*>()) parseColor(v["color2"].as<const char*>(), ring.p.c2);
  if (v["bri"].is<int>()) ring.p.bri = constrain(v["bri"].as<int>(), 0, 255);
  if (v["spd"].is<int>()) ring.p.spd = constrain(v["spd"].as<int>(), 1, 100);
  if (v["w"].is<int>()) ring.p.w = constrain(v["w"].as<int>(), 1, 24);
  if (v["aim"].is<float>()) ring.p.aim = v["aim"].as<float>();
  if (v["ct"].is<int>()) { ring.p.ct = constrain(v["ct"].as<int>(), 1500, 12000); ctDirty = millis(); }
}
static void applyCalib(JsonVariantConst v) {
  String s = "init pose stored:";
  bool all = !v.is<JsonArrayConst>() || v.as<JsonArrayConst>().size() == 0;
  for (int j = 0; j < NJ; j++) {
    bool pick = all;
    if (!all) for (JsonVariantConst n : v.as<JsonArrayConst>()) if (n.is<const char*>() && jointIndex(n.as<const char*>()) == j) pick = true;
    if (!pick) continue;
    s += ' '; s += JT[j].name; s += recenter(j) ? " ok" : " FAILED";
  }
  lastMsg = s;
}
static void applyCommand(JsonVariantConst d) {
  if (d["pose"].is<JsonObjectConst>()) applyPose(d["pose"]);
  if (d["led"].is<JsonObjectConst>()) applyLed(d["led"]);
  if (d["action"].is<const char*>()) startAction(d["action"].as<const char*>());
  if (d["name"].is<const char*>()) startAction(d["name"].as<const char*>());      // POST /api/action {"name":..}
  if (d["torque"].is<bool>()) setTorque(d["torque"].as<bool>());
  if (d["on"].is<bool>()) setTorque(d["on"].as<bool>());                          // POST /api/torque {"on":..}
  if (d["calib"].is<JsonArrayConst>()) applyCalib(d["calib"]);
  if (d["joints"].is<JsonArrayConst>()) applyCalib(d["joints"]);                  // POST /api/calib {"joints":[..]}
}

static void onWsEvent(AsyncWebSocket*, AsyncWebSocketClient* client, AwsEventType type, void* arg, uint8_t* data, size_t len) {
  if (type == WS_EVT_CONNECT) { client->text(statusJson(true)); return; }
  if (type != WS_EVT_DATA) return;
  AwsFrameInfo* info = (AwsFrameInfo*)arg;
  if (!info->final || info->index != 0 || info->len != len || info->opcode != WS_TEXT) return;
  JsonDocument d;
  if (deserializeJson(d, data, len)) return;
  applyCommand(d.as<JsonVariantConst>());
}

typedef void (*Handler)(JsonVariantConst);
static void jsonEndpoint(const char* path, Handler fn) {
  server.on(path, HTTP_POST, [](AsyncWebServerRequest*) {}, NULL, [fn](AsyncWebServerRequest* r, uint8_t* data, size_t len, size_t, size_t) {
    JsonDocument d;
    if (deserializeJson(d, data, len)) { r->send(400, "application/json", "{\"error\":\"bad json\"}"); return; }
    fn(d.as<JsonVariantConst>());
    r->send(200, "application/json", statusJson(false));
  });
}

static void setupWeb() {
  ws.onEvent(onWsEvent);
  server.addHandler(&ws);
  server.on("/", HTTP_GET, [](AsyncWebServerRequest* r) { r->send(200, "text/html", INDEX_HTML); });
  server.on("/api/status", HTTP_GET, [](AsyncWebServerRequest* r) { r->send(200, "application/json", statusJson(false)); });
  server.on("/api/actions", HTTP_GET, [](AsyncWebServerRequest* r) {
    String s = "["; for (int i = 0; i < NACTIONS; i++) { if (i) s += ','; s += '"'; s += ACTIONS[i].name; s += '"'; } s += "]"; r->send(200, "application/json", s);
  });
  jsonEndpoint("/api/pose", applyPose);                     // body = the pose object itself
  jsonEndpoint("/api/led", applyLed);                       // body = the led object itself
  jsonEndpoint("/api/action", applyCommand);                // {"name":"scan"}
  jsonEndpoint("/api/torque", applyCommand);                // {"on":false}
  jsonEndpoint("/api/calib", applyCommand);                 // {"joints":["yaw"]} or {"joints":[]}
  server.on("/api/scan", HTTP_GET, [](AsyncWebServerRequest* r) {
    String s = "found:"; for (uint8_t id = 1; id <= 20; id++) if (bus.ping(id)) { s += ' '; s += id; } r->send(200, "text/plain", s);
  });
  server.on("/api/bus", HTTP_GET, [](AsyncWebServerRequest* r) {    // /api/bus?id=1 -> raw bytes seen after a ping
    uint8_t id = r->hasParam("id") ? r->getParam("id")->value().toInt() : 1;
    uint8_t raw[64]; int n = bus.rawPing(id, raw, sizeof(raw));
    String s = "{\"id\":" + String(id) + ",\"got\":\"";
    for (int i = 0; i < n; i++) { char h[4]; snprintf(h, sizeof(h), "%02X ", raw[i]); s += h; }
    s += "\",\"n\":" + String(n) + "}";
    r->send(200, "application/json", s);
  });
  // Wiring diagnostic: normal and swapped RX/TX at several bauds, broadcast ping (254: every servo answers with
  // its own id), raw byte dump. Restores the configured pins afterwards; /api/diag?keep=1 keeps a working combo.
  server.on("/api/diag", HTTP_GET, [](AsyncWebServerRequest* r) {
    bool keep = r->hasParam("keep");
    const uint32_t bauds[3] = { 1000000, 500000, 115200 };
    String out; out.reserve(1500);
    diagBusy = true;
    bool found = false;
    for (int sw = 0; sw < 2 && !found; sw++) {
      int rx = sw ? BUS_TX : BUS_RX, tx = sw ? BUS_RX : BUS_TX;
      for (int bi = 0; bi < 3 && !found; bi++) {
        bus.reconfigure(bauds[bi], rx, tx);
        uint8_t buf[64]; int n = bus.rawPing(0xFE, buf, sizeof(buf), 25);
        out += sw ? "swapped" : "normal "; out += " rx=gpio"; out += rx; out += " tx=gpio"; out += tx; out += " baud="; out += bauds[bi];
        out += ": "; out += n; out += " bytes";
        if (n) { out += " ["; for (int i = 0; i < n; i++) { char h[4]; snprintf(h, sizeof(h), "%02X ", buf[i]); out += h; } out += "]"; }
        int id = -1;
        for (int i = 0; i + 5 < n; i++) if (buf[i] == 0xFF && buf[i + 1] == 0xFF && buf[i + 3] == 0x02 && buf[i + 2] != 0xFE) { id = buf[i + 2]; break; }
        if (id >= 0) { out += "  <-- SERVO ANSWERS, id "; out += id; found = true; }
        else if (n >= 6 && buf[0] == 0xFF && buf[1] == 0xFF && buf[2] == 0xFE) out += "  (only our own echo: adapter sees TX, no servo reply)";
        else if (n == 0) out += "  (nothing, not even echo)";
        out += "\n";
      }
    }
    if (found && keep) { out += "kept rx=gpio"; out += bus.rxPin(); out += " tx=gpio"; out += bus.txPin(); out += " baud="; out += bus.baud(); out += "\n"; }
    else bus.reconfigure(BUS_BAUD, BUS_RX, BUS_TX);
    diagBusy = false;
    r->send(200, "text/plain", out);
  });
  server.on("/api/init", HTTP_GET, [](AsyncWebServerRequest* r) { initServos(); r->send(200, "application/json", statusJson(false)); });
  server.onNotFound([](AsyncWebServerRequest* r) { r->redirect("/"); });
  server.begin();
}

static void setupWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.setHostname(MDNS_NAME);
  WiFi.begin(WIFI_STA_SSID, WIFI_STA_PASS);
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < WIFI_STA_TIMEOUT_MS) { delay(100); ring.p.mode = leds::SCANNER; ring.render(millis() / 1000.0f); }
  if (WiFi.status() == WL_CONNECTED) { apMode = false; ssidStr = WIFI_STA_SSID; ipStr = WiFi.localIP().toString(); }
  else {
    WiFi.disconnect(true); WiFi.mode(WIFI_AP);
    WiFi.softAP(WIFI_AP_SSID, strlen(WIFI_AP_PASS) >= 8 ? WIFI_AP_PASS : NULL);
    apMode = true; ssidStr = WIFI_AP_SSID; ipStr = WiFi.softAPIP().toString();
  }
  MDNS.begin(MDNS_NAME);
  MDNS.addService("http", "tcp", 80);
  ArduinoOTA.setHostname(MDNS_NAME);
  ArduinoOTA.onStart([]() { actIdx = -1; ring.p.mode = leds::OFF; ring.render(0); });
  ArduinoOTA.begin();
  ring.p.mode = leds::SPARKLE;
  Serial.printf("wifi: %s %s ip %s\n", apMode ? "AP" : "STA", ssidStr.c_str(), ipStr.c_str());
}

// ---------------------------------------------------------------- main
void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("\nNC lamp head controller");
  prefs.begin("lamp", false);
  ring.p.ct = prefs.getUShort("ct", 6500);
  ring.begin();
  bus.begin(BUS_BAUD, BUS_RX, BUS_TX);
  initServos();
  setupWifi();
  setupWeb();
}

void loop() {
  static uint32_t lastLed = 0, lastTele = 0, lastMotion = 0;
  uint32_t now = millis();
  ArduinoOTA.handle();
  if (now - lastMotion >= 20) {                               // 50 Hz: actions and slider targets
    lastMotion = now;
    tickAction();
    pushTargets();
    // Motion for the reactive effect, from the servos themselves: measured speed (also when moved by hand)
    // plus the distance still to travel to the target. Direction from yaw and head roll.
    float m = 0, dir = 0;
    for (int j = 0; j < NJ; j++) {
      if (!online[j] || !jstat[j].ok) continue;
      float v = JT[j].sign * jstat[j].speed / TICKS_PER_DEG;                        // deg/s, URDF sign
      float togo = torque ? fabsf(target[j] - toDeg(j, jstat[j].pos)) : 0;          // deg still to go
      m += fabsf(v) / 60.0f + togo / 25.0f;
      if (j == J_YAW) dir += v; else if (j == J_ROLL) dir += LED_ROLL_SIGN * v;
    }
    m = min(m, 1.0f);
    ring.p.motion += (m - ring.p.motion) * (m > ring.p.motion ? 0.25f : 0.05f);    // quick to light up, slow to fade
    if (fabsf(dir) > 5) ring.p.dir = dir > 0 ? 1 : -1;
    float roll = online[J_ROLL] && jstat[J_ROLL].ok ? toDeg(J_ROLL, jstat[J_ROLL].pos) : target[J_ROLL];
    ring.p.roll += (roll - ring.p.roll) * 0.25f;                                    // smooth between the 10 Hz readings
  }
  if (now - lastLed >= 1000 / LED_FPS) { lastLed = now; ring.render(now / 1000.0f); }
  if (now - lastTele >= TELEMETRY_MS) {
    lastTele = now;
    if (!diagBusy) for (int j = 0; j < NJ; j++) if (online[j]) jstat[j] = bus.status(JT[j].id);
    if (ctDirty && now - ctDirty > 1500) { prefs.putUShort("ct", ring.p.ct); ctDirty = 0; }   // save once the slider rests
    ws.cleanupClients();
    if (ws.count()) ws.textAll(statusJson(true));
    lastMsg = "";
  }
}
