#include "web.h"
#include "camera.h"
#include "config.h"
#include "detector.h"
#include "light.h"
#include "mcp.h"
#include "net.h"
#include "ota.h"
#include "search.h"
#include "servo.h"
#include "sys.h"
#include <cmath>
#include "web_page.h"
#include <cstdlib>
#include <cstring>
#include "cJSON.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char* TAG = "web";
static httpd_handle_t srv = nullptr;
static httpd_handle_t streamSrv = nullptr;
static float streamFps = 0;
static int viewers = 0;

static void cors(httpd_req_t* req) { httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*"); }

static esp_err_t sendJson(httpd_req_t* req, cJSON* o) {
    char* s = cJSON_PrintUnformatted(o);
    cJSON_Delete(o);
    if (!s) return httpd_resp_send_500(req);
    cors(req);
    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    esp_err_t r = httpd_resp_send(req, s, HTTPD_RESP_USE_STRLEN);
    free(s);
    return r;
}

// query value as a string; false if the key is not there
static bool query(httpd_req_t* req, const char* key, char* out, size_t n) {
    char buf[160];
    if (httpd_req_get_url_query_str(req, buf, sizeof buf) != ESP_OK) return false;
    return httpd_query_key_value(buf, key, out, n) == ESP_OK;
}
static bool queryBool(httpd_req_t* req, const char* key, bool* v) {
    char s[8];
    if (!query(req, key, s, sizeof s)) return false;
    *v = s[0] == '1' || s[0] == 't' || s[0] == 'T' || s[0] == 'y';
    return true;
}

static cJSON* detJson() {
    cJSON* d = cJSON_CreateObject();
    cJSON_AddBoolToObject(d, "ok", det::modelOk());
    cJSON_AddStringToObject(d, "model", det::modelName());
    cJSON_AddBoolToObject(d, "on", det::enabled());
    cJSON_AddNumberToObject(d, "thr", det::threshold());
    cJSON_AddBoolToObject(d, "be", det::bigEndian());
    det::Result r = det::latest();
    cJSON_AddNumberToObject(d, "ms", r.inferMs);
    cJSON_AddNumberToObject(d, "fps", det::fps());
    cJSON_AddNumberToObject(d, "seq", r.seq);
    cJSON_AddNumberToObject(d, "count", r.boxes.size());
    cJSON_AddNumberToObject(d, "age", r.tsUs ? (double)((esp_timer_get_time() - r.tsUs) / 1000) : -1);
    return d;
}

static esp_err_t hPage(httpd_req_t* req) {
    httpd_resp_set_type(req, "text/html; charset=utf-8");
    return httpd_resp_send(req, WEB_PAGE, HTTPD_RESP_USE_STRLEN);
}

static esp_err_t hStatus(httpd_req_t* req) {
    cJSON* o = cJSON_CreateObject();
    cJSON_AddNumberToObject(o, "up", sys::uptimeS());
    cJSON_AddNumberToObject(o, "heap", sys::freeHeap());
    cJSON_AddNumberToObject(o, "heapMaxDma", sys::largestDmaBlock());
    cJSON_AddNumberToObject(o, "psram", sys::freePsram());
    cJSON_AddNumberToObject(o, "psramTotal", sys::totalPsram());
    float t;
    if (sys::temperature(&t)) cJSON_AddNumberToObject(o, "temp", (double)((int)(t * 10)) / 10);
    else cJSON_AddNullToObject(o, "temp");
    cJSON* w = cJSON_AddObjectToObject(o, "wifi");
    cJSON_AddBoolToObject(w, "ap", net::isAp());
    cJSON_AddStringToObject(w, "ssid", net::ssid().c_str());
    cJSON_AddStringToObject(w, "ip", net::ip().c_str());
    cJSON_AddNumberToObject(w, "rssi", net::rssi());
    cJSON* c = cJSON_AddObjectToObject(o, "cam");
    cJSON_AddBoolToObject(c, "present", cam::present());   // false: no camera module on this lamp (CAM_ENABLED 0); the page then shows no camera card
    cJSON_AddBoolToObject(c, "ok", cam::ok());
    cJSON_AddNumberToObject(c, "w", cam::width());
    cJSON_AddNumberToObject(c, "h", cam::height());
    cJSON_AddNumberToObject(c, "fps", cam::fps());
    cJSON_AddNumberToObject(c, "streamFps", streamFps);
    cJSON_AddNumberToObject(c, "viewers", viewers);
    cJSON_AddStringToObject(c, "err", cam::lastError());
    cJSON_AddBoolToObject(c, "hflip", cam::hflip());
    cJSON_AddBoolToObject(c, "vflip", cam::vflip());
    cJSON_AddItemToObject(o, "det", detJson());
    cJSON* bt = cJSON_AddObjectToObject(o, "boot");
    cJSON_AddStringToObject(bt, "reason", sys::resetReason());
    cJSON_AddNumberToObject(bt, "lastStage", sys::lastStage());
    cJSON_AddBoolToObject(bt, "rolledBack", ota::rolledBack());
    cJSON_AddNumberToObject(bt, "lastDetector", sys::lastNote());
    cJSON* a = cJSON_AddObjectToObject(o, "app");
    cJSON_AddStringToObject(a, "version", ota::version());
    cJSON_AddStringToObject(a, "slot", ota::runningSlot());
    cJSON_AddBoolToObject(a, "updating", ota::busy());
    cJSON_AddNumberToObject(a, "progress", ota::progressPercent());
    return sendJson(req, o);
}

static esp_err_t hDetections(httpd_req_t* req) {
    det::Result r = det::latest();
    cJSON* o = cJSON_CreateObject();
    cJSON_AddNumberToObject(o, "seq", r.seq);
    cJSON_AddNumberToObject(o, "age", r.tsUs ? (double)((esp_timer_get_time() - r.tsUs) / 1000) : -1);
    cJSON_AddNumberToObject(o, "ms", r.inferMs);
    cJSON_AddNumberToObject(o, "w", r.w);
    cJSON_AddNumberToObject(o, "h", r.h);
    cJSON* arr = cJSON_AddArrayToObject(o, "boxes");
    for (const auto& b : r.boxes) {
        cJSON* j = cJSON_CreateObject();
        cJSON_AddNumberToObject(j, "c", b.cls);
        cJSON_AddStringToObject(j, "n", det::className(b.cls));
        cJSON_AddNumberToObject(j, "s", (double)((int)(b.score * 100)) / 100);
        int box[4] = {b.x0, b.y0, b.x1, b.y1};
        cJSON_AddItemToObject(j, "b", cJSON_CreateIntArray(box, 4));
        cJSON_AddItemToArray(arr, j);
    }
    return sendJson(req, o);
}

// /api/detect?on=1&thr=0.35&be=1  (GET or POST, query string)
static esp_err_t hDetect(httpd_req_t* req) {
    bool b;
    char s[16];
    if (queryBool(req, "on", &b)) {
        if (b && !cam::ok()) cam::start();     // the model needs the picture
        det::setEnabled(b);
    }
    if (queryBool(req, "be", &b)) det::setBigEndian(b);
    if (query(req, "thr", s, sizeof s)) det::setThreshold(strtof(s, nullptr));
    return sendJson(req, detJson());
}

// /api/cam?hflip=1&vflip=0
static esp_err_t hCam(httpd_req_t* req) {
    bool on;
    if (queryBool(req, "on", &on)) {           // /api/cam?on=0 also stops the detector: it has nothing to look at
        if (on) cam::start();
        else { det::setEnabled(false); cam::stop(); }
    }
    bool h = cam::hflip(), v = cam::vflip();
    bool any = queryBool(req, "hflip", &h);
    any |= queryBool(req, "vflip", &v);
    if (any) cam::setFlip(h, v);
    char s[8];
    if (query(req, "ae", s, sizeof s)) cam::setAeLevel(atoi(s));
    cJSON* c = cJSON_CreateObject();
    cJSON_AddBoolToObject(c, "ok", cam::ok());
    cJSON_AddBoolToObject(c, "hflip", cam::hflip());
    cJSON_AddBoolToObject(c, "vflip", cam::vflip());
    cJSON_AddNumberToObject(c, "ae", cam::aeLevel());
    return sendJson(req, c);
}

// ---- lamp: light + servos ------------------------------------------------------------------------------------------
static std::string hexColor(light::RGB c) {
    char b[8];
    snprintf(b, sizeof b, "#%02x%02x%02x", (int)c.r, (int)c.g, (int)c.b);
    return b;
}
static bool parseColor(const char* s, light::RGB& c) {
    if (!s || s[0] != '#' || strlen(s) != 7) return false;
    long v = strtol(s + 1, nullptr, 16);
    c = {(float)((v >> 16) & 255), (float)((v >> 8) & 255), (float)(v & 255)};
    return true;
}
static cJSON* lampJson() {
    cJSON* o = cJSON_CreateObject();
    cJSON_AddBoolToObject(o, "torque", servo::torque());
    cJSON_AddNumberToObject(o, "speed", servo::speed());
    cJSON_AddNumberToObject(o, "acc", servo::acc());
    cJSON_AddStringToObject(o, "action", servo::action());
    cJSON_AddBoolToObject(o, "floorBlocked", servo::floorBlocked());
    std::string m = servo::lastMsg();
    if (!m.empty()) cJSON_AddStringToObject(o, "msg", m.c_str());
    cJSON* js = cJSON_AddArrayToObject(o, "joints");
    for (int j = 0; j < servo::NJ; j++) {
        servo::Joint q = servo::joint(j);
        cJSON* x = cJSON_CreateObject();
        cJSON_AddStringToObject(x, "name", q.name);
        cJSON_AddNumberToObject(x, "id", q.id);
        cJSON_AddBoolToObject(x, "ok", q.ok);
        cJSON_AddNumberToObject(x, "target", (double)((int)(q.target * 10)) / 10);
        cJSON_AddNumberToObject(x, "deg", (double)((int)(q.deg * 10)) / 10);
        cJSON_AddNumberToObject(x, "ticks", q.ticks);
        cJSON_AddNumberToObject(x, "load", q.load);
        cJSON_AddNumberToObject(x, "temp", q.temp);
        cJSON_AddNumberToObject(x, "v", q.volt);
        cJSON_AddNumberToObject(x, "mA", q.mA);
        cJSON_AddNumberToObject(x, "min", q.lo);
        cJSON_AddNumberToObject(x, "max", q.hi);
        cJSON_AddItemToArray(js, x);
    }
    {   // the hold test (0.32): none / running / held / moved (joint, drift) / cancelled
        servo::Hold hd = servo::hold();
        cJSON* h = cJSON_AddObjectToObject(o, "hold");
        cJSON_AddStringToObject(h, "result", hd.running ? "running" : !hd.done ? "none" : hd.tripped == -1 ? "held" : hd.tripped == -2 ? "cancelled" : "moved");
        if (hd.done && hd.tripped >= 0) cJSON_AddStringToObject(h, "joint", servo::joint(hd.tripped).name);
        cJSON_AddNumberToObject(h, "ms", hd.ms);
        cJSON_AddNumberToObject(h, "maxDeg", hd.maxDeg);
        cJSON* d = cJSON_AddObjectToObject(h, "drift");
        for (int j = 0; j < servo::NJ; j++) cJSON_AddNumberToObject(d, servo::joint(j).name, (double)lroundf(hd.drift[j] * 10) / 10);
    }
    light::Params p = light::get();
    cJSON* l = cJSON_AddObjectToObject(o, "led");
    cJSON_AddBoolToObject(l, "ok", light::ok());
    cJSON_AddStringToObject(l, "mode", light::modeName(p.mode));
    cJSON_AddStringToObject(l, "color", hexColor(p.c1).c_str());
    cJSON_AddStringToObject(l, "color2", hexColor(p.c2).c_str());
    cJSON_AddNumberToObject(l, "bri", p.bri);
    cJSON_AddNumberToObject(l, "spd", p.spd);
    cJSON_AddNumberToObject(l, "w", p.w);
    cJSON_AddNumberToObject(l, "aim", (int)p.aim);
    cJSON_AddNumberToObject(l, "eye", p.eye);
    cJSON_AddNumberToObject(l, "ct", p.ct);
    cJSON_AddNumberToObject(l, "n", LED_COUNT);
    cJSON_AddStringToObject(l, "clock", light::clockStr().c_str());
    cJSON_AddStringToObject(l, "leds", light::frameHex().c_str());
    cJSON* modes = cJSON_AddArrayToObject(l, "modes");
    for (int k = 0; k < light::modeCount(); k++) cJSON_AddItemToArray(modes, cJSON_CreateString(light::modeName((light::Mode)k)));
    cJSON* id = cJSON_AddObjectToObject(l, "idle");
    cJSON_AddStringToObject(id, "set", light::idleSetting());
    cJSON_AddStringToObject(id, "now", light::idleMode());
    cJSON* ch = cJSON_AddArrayToObject(id, "choices");
    for (int k = 0; k < light::idleChoiceCount(); k++) cJSON_AddItemToArray(ch, cJSON_CreateString(light::idleChoice(k)));
    cJSON* acts = cJSON_AddArrayToObject(o, "actions");
    for (int i = 0; i < servo::actionCount(); i++) cJSON_AddItemToArray(acts, cJSON_CreateString(servo::actionName(i)));
    cJSON* sp = cJSON_AddArrayToObject(o, "safePoses");   // 0.35: the actions that stand by themselves with the motors off, with their angles
    for (int i = 0; i < servo::actionCount(); i++) {
        if (!servo::actionSafe(i)) continue;
        cJSON* x = cJSON_CreateObject();
        cJSON_AddStringToObject(x, "name", servo::actionName(i));
        float q[servo::NJ];
        servo::actionPose(i, q);
        cJSON* qa = cJSON_AddArrayToObject(x, "q");
        for (int j = 0; j < servo::NJ; j++) cJSON_AddItemToArray(qa, std::isnan(q[j]) ? cJSON_CreateNull() : cJSON_CreateNumber(q[j]));
        cJSON_AddItemToArray(sp, x);
    }
    cJSON_AddBoolToObject(o, "inSafePose", servo::inSafePose());
    cJSON* s = cJSON_AddObjectToObject(o, "search");
    cJSON_AddBoolToObject(s, "on", search::on());
    cJSON_AddStringToObject(s, "state", search::state());
    cJSON_AddStringToObject(s, "target", search::target().c_str());
    cJSON_AddNumberToObject(s, "cls", search::targetCls());
    cJSON_AddNumberToObject(s, "score", (double)((int)(search::targetScore() * 100)) / 100);
    cJSON_AddStringToObject(s, "seen", search::seen().c_str());
    cJSON_AddNumberToObject(s, "stop", search::stop());
    return o;
}
static cJSON* readBody(httpd_req_t* req);
static esp_err_t badJson(httpd_req_t* req);
// POST /api/idle {"mode":"random"}: the ring mode at power-on and after a search, saved to flash; shown at once
static esp_err_t hIdle(httpd_req_t* req) {
    cJSON* d = readBody(req);
    if (!d) return badJson(req);
    cJSON* v;
    bool ok = true;
    if (cJSON_IsString(v = cJSON_GetObjectItem(d, "mode"))) ok = light::setIdle(v->valuestring, true);
    cJSON_Delete(d);
    if (!ok) return badJson(req);
    return sendJson(req, lampJson());
}
// POST /api/search {"on":true}
static esp_err_t hSearch(httpd_req_t* req) {
    cJSON* d = readBody(req);
    if (!d) return badJson(req);
    cJSON* v;
    if (cJSON_IsBool(v = cJSON_GetObjectItem(d, "on"))) search::setOn(cJSON_IsTrue(v));
    cJSON_Delete(d);
    return sendJson(req, lampJson());
}
static esp_err_t hLamp(httpd_req_t* req) { return sendJson(req, lampJson()); }

// JSON body of a POST (up to 2 kB), or nullptr
static cJSON* readBody(httpd_req_t* req) {
    if (req->content_len == 0 || req->content_len > 2048) return nullptr;
    char buf[2049];
    size_t got = 0;
    while (got < req->content_len) {
        int r = httpd_req_recv(req, buf + got, req->content_len - got);
        if (r <= 0) return nullptr;
        got += r;
    }
    buf[got] = 0;
    return cJSON_Parse(buf);
}
static esp_err_t badJson(httpd_req_t* req) { return httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "bad json"); }

// POST /api/pose {"yaw":30,"wrist":20,"speed":600,"acc":40}
static esp_err_t hPose(httpd_req_t* req) {
    cJSON* d = readBody(req);
    if (!d) return badJson(req);
    float q[servo::NJ];
    bool has[servo::NJ];
    for (int j = 0; j < servo::NJ; j++) {
        cJSON* v = cJSON_GetObjectItem(d, servo::joint(j).name);
        has[j] = cJSON_IsNumber(v);
        q[j] = has[j] ? (float)v->valuedouble : 0;
    }
    cJSON *sp = cJSON_GetObjectItem(d, "speed"), *ac = cJSON_GetObjectItem(d, "acc");
    servo::setSpeedAcc(cJSON_IsNumber(sp) ? sp->valueint : -1, cJSON_IsNumber(ac) ? ac->valueint : -1);
    for (int j = 0; j < servo::NJ; j++) if (has[j]) search::setOn(false);   // a slider takes over from the search
    servo::setPose(q, has);
    cJSON_Delete(d);
    return sendJson(req, lampJson());
}
// POST /api/led {"mode":"solid","color":"#ff8800","color2":"#000000","bri":150,"spd":40,"w":6,"aim":90,"eye":1,"ct":4000,"progress":0.5}
// (progress: to preview the "update" bar; a real upload drives it)
static esp_err_t hLed(httpd_req_t* req) {
    cJSON* d = readBody(req);
    if (!d) return badJson(req);
    web::applyLed(d);
    cJSON_Delete(d);
    return sendJson(req, lampJson());
}
// POST /api/action {"name":"wake"}  ("" stops);  POST /api/torque {"on":true};  POST /api/calib {"joints":["yaw"]} ([] = all)
static esp_err_t hAction(httpd_req_t* req) {
    cJSON* d = readBody(req);
    if (!d) return badJson(req);
    cJSON* n = cJSON_GetObjectItem(d, "name");
    search::setOn(false);                                                     // an action takes over from the search
    bool okv = servo::startAction(cJSON_IsString(n) ? n->valuestring : "");
    cJSON_Delete(d);
    if (!okv) return httpd_resp_send_err(req, HTTPD_404_NOT_FOUND, "no such action");
    return sendJson(req, lampJson());
}
static esp_err_t hTorque(httpd_req_t* req) {
    cJSON* d = readBody(req);
    if (!d) return badJson(req);
    cJSON* v = cJSON_GetObjectItem(d, "on");
    if (cJSON_IsBool(v)) {
        if (!cJSON_IsTrue(v)) search::setOn(false);   // the search would move the head during the move to the default pose and cancel the torque off
        servo::setTorque(cJSON_IsTrue(v));
    }
    cJSON_Delete(d);
    return sendJson(req, lampJson());
}
// POST /api/hold {"s":5,"maxDeg":2}: the hold test (0.32); the answer comes when it is over (up to HOLD_MAX_MS), see "hold"
static esp_err_t hHold(httpd_req_t* req) {
    cJSON* d = readBody(req);
    if (!d) return badJson(req);
    cJSON *s = cJSON_GetObjectItem(d, "s"), *m = cJSON_GetObjectItem(d, "maxDeg");
    float sec = cJSON_IsNumber(s) ? (float)s->valuedouble : 5.0f, maxDeg = cJSON_IsNumber(m) ? (float)m->valuedouble : 2.0f;
    cJSON_Delete(d);
    search::setOn(false);
    if (!servo::holdTest(maxDeg, (uint32_t)(sec * 1000))) {
        std::string why = std::string("hold test refused: ") + servo::holdRefusal();
        return httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, why.c_str());
    }
    web::waitHold();
    return sendJson(req, lampJson());
}
static esp_err_t hCalib(httpd_req_t* req) {
    cJSON* d = readBody(req);
    if (!d) return badJson(req);
    cJSON* arr = cJSON_GetObjectItem(d, "joints");
    bool all = !cJSON_IsArray(arr) || cJSON_GetArraySize(arr) == 0;
    for (int j = 0; j < servo::NJ; j++) {
        bool pick = all;
        if (!all) { cJSON* n; cJSON_ArrayForEach(n, arr) if (cJSON_IsString(n) && servo::jointIndex(n->valuestring) == j) pick = true; }
        if (pick) servo::calibrate(j);
    }
    cJSON_Delete(d);
    return sendJson(req, lampJson());
}

static esp_err_t sendJpeg(httpd_req_t* req, uint8_t* buf, size_t len) {
    cors(req);
    httpd_resp_set_type(req, "image/jpeg");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    esp_err_t r = httpd_resp_send(req, (const char*)buf, len);
    free(buf);
    return r;
}

static esp_err_t hJpg(httpd_req_t* req) {
    uint8_t* buf = nullptr;
    size_t len = 0;
    if (!cam::jpeg(&buf, &len)) return httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "no frame");
    return sendJpeg(req, buf, len);
}

static esp_err_t hAnalysed(httpd_req_t* req) {
    uint8_t* buf = nullptr;
    size_t len = 0;
    if (!det::analysedJpeg(&buf, &len)) return httpd_resp_send_err(req, HTTPD_404_NOT_FOUND, "nothing analysed yet");
    return sendJpeg(req, buf, len);
}

static const char* STREAM_TYPE = "multipart/x-mixed-replace;boundary=frame";
static const char* STREAM_BOUNDARY = "\r\n--frame\r\n";
static const char* STREAM_PART = "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";

static esp_err_t hStream(httpd_req_t* req) {
    cors(req);
    if (!cam::ok()) {                        // camera off: a real answer, the page's Camera button starts it
        httpd_resp_set_status(req, "503 Service Unavailable");
        return httpd_resp_sendstr(req, cam::present() ? "camera off" : "no camera module on this lamp");
    }
    if (httpd_resp_set_type(req, STREAM_TYPE) != ESP_OK) return ESP_FAIL;
    viewers++;
    uint32_t n = 0;
    int64_t t0 = esp_timer_get_time();
    esp_err_t res = ESP_OK;
    int64_t next = esp_timer_get_time();
    while (res == ESP_OK) {
        // pace the stream: the JPEG encoder would otherwise eat the time the model needs
        int64_t t = esp_timer_get_time();
        if (t < next) vTaskDelay(pdMS_TO_TICKS((next - t) / 1000 + 1));
        next = esp_timer_get_time() + 1000000 / STREAM_MAX_FPS;
        uint8_t* buf = nullptr;
        size_t len = 0;
        if (!cam::jpeg(&buf, &len)) {
            if (!cam::ok()) { httpd_resp_send_chunk(req, nullptr, 0); break; }   // camera switched off: end the stream properly
            vTaskDelay(pdMS_TO_TICKS(50));
            continue;
        }
        char part[64];
        int pl = snprintf(part, sizeof part, STREAM_PART, (unsigned)len);
        res = httpd_resp_send_chunk(req, STREAM_BOUNDARY, strlen(STREAM_BOUNDARY));
        if (res == ESP_OK) res = httpd_resp_send_chunk(req, part, pl);
        if (res == ESP_OK) res = httpd_resp_send_chunk(req, (const char*)buf, len);
        free(buf);
        n++;
        int64_t now = esp_timer_get_time();
        if (now - t0 >= 2000000) {
            streamFps = n * 1000000.0f / (now - t0);
            n = 0;
            t0 = now;
        }
    }
    viewers--;
    streamFps = 0;
    return res;
}

static void add(httpd_handle_t h, const char* uri, httpd_method_t m, esp_err_t (*fn)(httpd_req_t*)) {
    httpd_uri_t u = {};
    u.uri = uri;
    u.method = m;
    u.handler = fn;
    httpd_register_uri_handler(h, &u);
}

namespace web {

cJSON* lampJson() { return ::lampJson(); }
void waitHold() {   // block the calling (http) task until the hold test is over, HOLD_MAX_MS + 1 s at most
    int64_t t0 = esp_timer_get_time();
    while (servo::hold().running && esp_timer_get_time() - t0 < (HOLD_MAX_MS + 1000) * 1000LL) vTaskDelay(pdMS_TO_TICKS(50));
}

// The fields of POST /api/led (also the MCP tool lamp_light): mode, color, color2, bri, spd, w, aim, eye, ct, progress.
// Fields missing or of the wrong type keep their value.
void applyLed(const cJSON* d) {
    light::Params p = light::get();
    const cJSON* v;
    if (cJSON_IsString(v = cJSON_GetObjectItem(d, "mode"))) { light::Params t = p; for (int k = 0; k < light::modeCount(); k++) if (strcmp(light::modeName((light::Mode)k), v->valuestring) == 0) t.mode = (light::Mode)k; p = t; }
    if (cJSON_IsString(v = cJSON_GetObjectItem(d, "color"))) parseColor(v->valuestring, p.c1);
    if (cJSON_IsString(v = cJSON_GetObjectItem(d, "color2"))) parseColor(v->valuestring, p.c2);
    if (cJSON_IsNumber(v = cJSON_GetObjectItem(d, "bri"))) p.bri = (uint8_t)std::min(std::max(v->valueint, 0), 255);
    if (cJSON_IsNumber(v = cJSON_GetObjectItem(d, "spd"))) p.spd = (uint8_t)std::min(std::max(v->valueint, 1), 100);
    if (cJSON_IsNumber(v = cJSON_GetObjectItem(d, "w"))) p.w = (uint8_t)std::min(std::max(v->valueint, 1), 24);
    if (cJSON_IsNumber(v = cJSON_GetObjectItem(d, "aim"))) p.aim = (float)v->valuedouble;
    if (cJSON_IsNumber(v = cJSON_GetObjectItem(d, "eye"))) p.eye = std::min(std::max((float)v->valuedouble, 0.0f), 1.0f);
    bool ctChanged = false;
    if (cJSON_IsNumber(v = cJSON_GetObjectItem(d, "ct"))) { p.ct = (uint16_t)std::min(std::max(v->valueint, 1500), 12000); ctChanged = true; }
    light::set(p);
    if (cJSON_IsNumber(v = cJSON_GetObjectItem(d, "progress"))) light::setProgress((float)v->valuedouble);
    if (ctChanged) light::saveWhiteBalance();
}

void begin() {
    httpd_config_t c = HTTPD_DEFAULT_CONFIG();
    c.server_port = WEB_PORT;
    c.ctrl_port = 32768;
    c.stack_size = 8192;
    c.max_uri_handlers = 24;                 // 19 of ours + 4 for /mcp
    c.lru_purge_enable = true;
    if (httpd_start(&srv, &c) == ESP_OK) {
        add(srv, "/", HTTP_GET, hPage);
        add(srv, "/api/status", HTTP_GET, hStatus);
        add(srv, "/api/detections", HTTP_GET, hDetections);
        add(srv, "/api/detect", HTTP_GET, hDetect);
        add(srv, "/api/detect", HTTP_POST, hDetect);
        add(srv, "/api/cam", HTTP_GET, hCam);
        add(srv, "/api/cam", HTTP_POST, hCam);
        add(srv, "/jpg", HTTP_GET, hJpg);
        add(srv, "/analysed.jpg", HTTP_GET, hAnalysed);
        add(srv, "/update", HTTP_POST, ota::handleUpdate);
        add(srv, "/api/lamp", HTTP_GET, hLamp);
        add(srv, "/api/pose", HTTP_POST, hPose);
        add(srv, "/api/led", HTTP_POST, hLed);
        add(srv, "/api/action", HTTP_POST, hAction);
        add(srv, "/api/torque", HTTP_POST, hTorque);
        add(srv, "/api/calib", HTTP_POST, hCalib);
        add(srv, "/api/hold", HTTP_POST, hHold);
        add(srv, "/api/search", HTTP_POST, hSearch);
        add(srv, "/api/idle", HTTP_POST, hIdle);
        mcp::attach(srv);                    // POST /mcp for AI clients (mcp.h)
        ESP_LOGI(TAG, "page on port %d", WEB_PORT);
    } else {
        ESP_LOGE(TAG, "web server did not start");
    }
    httpd_config_t s = HTTPD_DEFAULT_CONFIG();
    s.server_port = STREAM_PORT;
    s.ctrl_port = 32769;
    s.stack_size = 8192;
    s.max_open_sockets = 3;
    s.lru_purge_enable = true;
    if (httpd_start(&streamSrv, &s) == ESP_OK) {
        add(streamSrv, "/stream", HTTP_GET, hStream);
        ESP_LOGI(TAG, "stream on port %d", STREAM_PORT);
    } else {
        ESP_LOGE(TAG, "stream server did not start");
    }
}

}  // namespace web
