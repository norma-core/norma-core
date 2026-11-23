// MCP server for the lamp: see mcp.h. One JSON-RPC message per POST, the answer is a JSON body (the spec allows a
// server to answer a request with plain JSON instead of an SSE stream; notifications get an empty 202). No session
// id is issued, every request stands alone, so a client can reconnect at any time after a lamp reboot.
// Protocol versions 2024-11-05 .. 2025-06-18 are all the same for what is used here (initialize, ping, tools/list,
// tools/call); the version the client asks for is echoed when it is one of those.
#include "mcp.h"
#include "camera.h"
#include "config.h"
#include "detector.h"
#include "light.h"
#include "net.h"
#include "ota.h"
#include "search.h"
#include "servo.h"
#include "web.h"
#include <algorithm>
#include <cstdlib>
#include <cstring>
#include <string>
#include "cJSON.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "mbedtls/base64.h"

static const char* TAG = "mcp";

namespace mcp {

static const char* const VERSIONS[] = {"2025-06-18", "2025-03-26", "2024-11-05"};
static const size_t MAX_BODY = 8192;

// ---------------------------------------------------------------- tool schemas
static cJSON* addTool(cJSON* tools, const char* name, const char* description) {
    cJSON* t = cJSON_CreateObject();
    cJSON_AddStringToObject(t, "name", name);
    cJSON_AddStringToObject(t, "description", description);
    cJSON* s = cJSON_AddObjectToObject(t, "inputSchema");
    cJSON_AddStringToObject(s, "type", "object");
    cJSON_AddObjectToObject(s, "properties");
    cJSON_AddItemToArray(tools, t);
    return s;
}
static cJSON* addProp(cJSON* schema, const char* name, const char* type, const char* description) {
    cJSON* p = cJSON_CreateObject();
    cJSON_AddStringToObject(p, "type", type);
    cJSON_AddStringToObject(p, "description", description);
    cJSON_AddItemToObject(cJSON_GetObjectItem(schema, "properties"), name, p);
    return p;
}
static cJSON* addNumber(cJSON* schema, const char* name, const char* description, double lo, double hi, bool integer = false) {
    cJSON* p = addProp(schema, name, integer ? "integer" : "number", description);
    cJSON_AddNumberToObject(p, "minimum", lo);
    cJSON_AddNumberToObject(p, "maximum", hi);
    return p;
}
static void require(cJSON* schema, const char* name) {
    cJSON* r = cJSON_GetObjectItem(schema, "required");
    if (!r) r = cJSON_AddArrayToObject(schema, "required");
    cJSON_AddItemToArray(r, cJSON_CreateString(name));
}

static void listTools(cJSON* result) {
    cJSON* tools = cJSON_AddArrayToObject(result, "tools");
    addTool(tools, "lamp_status", cam::present()
            ? "Read the lamp: joint angles (deg, target and measured), load, temperature, voltage, torque on/off, the running gesture, the light, "
              "the search (find and follow), the camera, the object detector, Wi-Fi, firmware version."
            : "Read the lamp: joint angles (deg, target and measured), load, temperature, voltage, torque on/off, the running gesture, the light, "
              "Wi-Fi, firmware version.");
    {
        cJSON* s = addTool(tools, "lamp_pose",
            "Move the lamp to a pose. Angles in degrees, URDF convention: yaw 0 = straight ahead (+ = left), shoulder 90 = arm vertical "
            "(smaller = leaning forward over the desk, larger = folded back), elbow 0 = straight (- = folded back), wrist + = head tilted down "
            "towards the desk, roll 0 = head level. Joints left out keep their angle. The move is refused if the shade rim would come below "
            "15 mm from the desk. Pointing up = all 0 and shoulder 90. Default pose (desk) = shoulder 110, elbow -40, wrist -30; folded rest pose = 133, -78, -15. A pose ends a running search.");
        static const char* const DESC[] = {"base turn, + = left", "arm pitch, 90 = vertical, 35 = far forward, 133 = folded back (rest)",
                                           "forearm, - = folded back", "head pitch, + = down towards the desk", "head roll"};
        for (int j = 0; j < servo::NJ; j++) {
            servo::Joint q = servo::joint(j);
            addNumber(s, q.name, DESC[j], q.lo, q.hi);
        }
        addNumber(s, "speed", "servo speed in ticks/s (4096 ticks = 360 deg), default 900, kept for the next moves", 50, 3400, true);
        addNumber(s, "acc", "ramp, x100 ticks/s^2, default 40, kept for the next moves", 1, 254, true);
    }
    {
        cJSON* s = addTool(tools, "lamp_action",
            "Play a gesture with its own light: up (point up, warm light), lookdown (light on the desk), reach (reading light), wake, scan, spin, "
            "bounce, no (head shake, red), yes (nod, green), peek, warning (rears up, shakes, amber flashes: for attention), resolved (the all-clear: "
            "sigh, green nod), stop (end the running gesture). Every gesture ends in the default pose desk. "
            "Safe poses, measured to stand by themselves with the motors off (they keep the light as it is and stay): desk (the default: work light, "
            "head over the base at 404 mm, 50 deg down, spot 400 mm out), rest (folded back on itself), close (70 deg down, spot 245 mm), far (40 deg down, "
            "spot 560 mm), down (straight down at the base), ahead (looking level ahead), ceiling (85 deg up). lamp_torque off in one of them "
            "switches the motors off where the arm is. "
            "Gestures take 1 to 10 s and return at once; lamp_status shows action \"\" when they are done. A gesture ends a running search.");
        cJSON* p = addProp(s, "name", "string", "the gesture");
        cJSON* e = cJSON_AddArrayToObject(p, "enum");
        for (int i = 0; i < servo::actionCount(); i++) cJSON_AddItemToArray(e, cJSON_CreateString(servo::actionName(i)));
        cJSON_AddItemToArray(e, cJSON_CreateString("stop"));
        require(s, "name");
    }
    {
        cJSON* s = addTool(tools, "lamp_light",
            "Set the light ring in the shade. Modes: off, solid, breathe, rainbow, comet, chase, scanner, sparkle, fire, follow (a sector aimed at "
            "`aim` deg on a clock face, 180 = down on the desk), reactive (follows the motion), clock (a clock face with hands), eye (an eye with "
            "lids, `eye` 0 shut .. 1 open), aurora, stars, mood (the idle looks). Fields left out keep their value. Warm work light: mode solid, "
            "color #ffb15c. `idle` sets the look at power-on and after a search (kept in flash; random = one of them at each boot).");
        cJSON* m = addProp(s, "mode", "string", "light effect");
        cJSON* e = cJSON_AddArrayToObject(m, "enum");
        for (int k = 0; k < light::modeCount(); k++) {
            const char* n = light::modeName((light::Mode)k);
            if (k == light::SEARCH || k == light::NOTHING || k == light::PARTS || k == light::UPDATE) continue;   // the search's and the OTA's own lights
            cJSON_AddItemToArray(e, cJSON_CreateString(n));
        }
        addProp(s, "color", "string", "main colour, #rrggbb");
        addProp(s, "color2", "string", "second colour, #rrggbb (chase, comet background)");
        addNumber(s, "bri", "brightness 0..255", 0, 255, true);
        addNumber(s, "spd", "effect speed 1..100", 1, 100, true);
        addNumber(s, "w", "width in LEDs for comet, chase, scanner, follow (1..24)", 1, 24, true);
        addNumber(s, "aim", "follow mode: clock angle of the lit sector, 0 = top, 90 = right, 180 = bottom (desk)", 0, 360);
        addNumber(s, "eye", "eye mode: how far the lids are open, 0..1", 0, 1);
        addNumber(s, "ct", "white balance in Kelvin, 6500 = none, lower = warmer (kept in flash)", 1500, 12000, true);
        cJSON* id = addProp(s, "idle", "string", "the idle look: shown at power-on and after a search, kept in flash");
        cJSON* ie = cJSON_AddArrayToObject(id, "enum");
        for (int k = 0; k < light::idleChoiceCount(); k++) cJSON_AddItemToArray(ie, cJSON_CreateString(light::idleChoice(k)));
    }
    {
        cJSON* s = addTool(tools, "lamp_torque",
            "Switch the motors on (hold the pose the arm is in; needed before any pose or gesture moves) or off (in one of the safe poses of "
            "lamp_action the motors go off where the arm is; anywhere else the arm goes to the default pose desk first, then goes limp and can be "
            "posed by hand). lamp_status inSafePose says which it will be. Kept in flash.");
        addProp(s, "on", "boolean", "true = hold, false = rest and release");
        require(s, "on");
    }
    {
        cJSON* s = addTool(tools, "lamp_hold_test",
            "Does the pose the arm is in stand by itself without power? The motors switch off where the arm is, every joint is watched at 50 Hz, "
            "and they switch back on (holding where the arm is then) as soon as one joint drifts more than maxDeg or when the seconds are up. "
            "The answer comes when the test is over: hold.result \"held\" = a safe pose, the arm keeps standing with the motors off; \"moved\" = "
            "hold.joint gave way (hold.drift per joint, deg). Refused with the motors off, during a gesture, with the shade closer than 40 mm "
            "to the desk, or when the shoulder already works at a load above 50 with the motors on: measured 2026-11-10, the shoulder gearbox "
            "holds up to a load of about 48 and the pose falls from 56, the other joints never fell. Move there with lamp_pose first and read "
            "the shoulder load in lamp_status.");
        addNumber(s, "seconds", "how long the motors stay off, default 5", 0.5, 15);
        addNumber(s, "maxDeg", "drift that ends the test and brings the motors back, default 2, at most 4 (a wider trip let the lamp tip over)", 0.3, 4);
    }
    if (!cam::present()) return;                                              // no camera module: the camera, photo, search and detector tools are not offered
    {
        cJSON* s = addTool(tools, "lamp_camera",
            "Camera settings (the Sense camera looking out of the shade along the head axis, 320x240 for the detector): on/off, mirror, flip, "
            "exposure. Switching on takes about a second; lamp_photo needs it on. Switching off also stops the detector and the search.");
        addProp(s, "on", "boolean", "camera on or off");
        addProp(s, "hflip", "boolean", "mirror");
        addProp(s, "vflip", "boolean", "upside down");
        addNumber(s, "ae", "exposure target, -2 dark .. 2 bright", -2, 2, true);
    }
    addTool(tools, "lamp_photo", "Take one picture with the lamp's camera (JPEG 320x240). The camera must be on (lamp_camera). "
            "A bright ring washes the picture out: set lamp_light bri 50 or less (or mode off) first.");
    {
        cJSON* s = addTool(tools, "lamp_search",
            "Find and follow: the head goes up, sweeps the desk in three looks and, when it sees a fruit (banana, apple, carrot; or exactly one "
            "other known object), lights the ring in its colour, comes down and keeps it in the middle of the picture. on=true starts it (the "
            "motors must be on, the camera and the detector are started), on=false stops it. lamp_status shows search.state and target.");
        addProp(s, "on", "boolean", "true = search and follow, false = stop");
        require(s, "on");
    }
    {
        cJSON* s = addTool(tools, "lamp_detector",
            "The YOLO11n object detector (80 COCO classes) running on the camera picture, about one frame in 1.5 s. on=true starts the camera "
            "and the detector, thr sets the score threshold. Read the boxes with lamp_detections. The detector sees better with the ring "
            "dimmed (lamp_light bri 50 or less): a bright ring floods the desk with its colour.");
        addProp(s, "on", "boolean", "detector on or off");
        addNumber(s, "thr", "score threshold 0..1 (default 0.35)", 0, 1);
    }
    addTool(tools, "lamp_detections",
            "The objects the detector saw in the last analysed frame: class name, score, box in camera pixels (320x240), plus the frame's age in ms.");
}

// ---------------------------------------------------------------- results
static void textResult(cJSON* result, const char* text, bool isError = false) {
    cJSON* c = cJSON_CreateObject();
    cJSON_AddStringToObject(c, "type", "text");
    cJSON_AddStringToObject(c, "text", text);
    cJSON_AddItemToArray(cJSON_AddArrayToObject(result, "content"), c);
    if (isError) cJSON_AddBoolToObject(result, "isError", true);
}
// The lamp status (web::lampJson) with a few lines about the rest of the head, so the model sees what its call did.
static cJSON* statusJson() {
    cJSON* o = web::lampJson();
    cJSON_AddStringToObject(o, "version", ota::version());
    cJSON* w = cJSON_AddObjectToObject(o, "wifi");
    cJSON_AddStringToObject(w, "ip", net::ip().c_str());
    cJSON_AddNumberToObject(w, "rssi", net::rssi());
    cJSON* c = cJSON_AddObjectToObject(o, "cam");
    cJSON_AddBoolToObject(c, "present", cam::present());
    cJSON_AddBoolToObject(c, "on", cam::ok());
    cJSON_AddNumberToObject(c, "w", cam::width());
    cJSON_AddNumberToObject(c, "h", cam::height());
    cJSON_AddBoolToObject(c, "hflip", cam::hflip());
    cJSON_AddBoolToObject(c, "vflip", cam::vflip());
    cJSON_AddNumberToObject(c, "ae", cam::aeLevel());
    det::Result r = det::latest();
    cJSON* d = cJSON_AddObjectToObject(o, "det");
    cJSON_AddBoolToObject(d, "on", det::enabled());
    cJSON_AddBoolToObject(d, "modelOk", det::modelOk());
    cJSON_AddNumberToObject(d, "thr", det::threshold());
    cJSON_AddNumberToObject(d, "count", r.boxes.size());
    cJSON_AddNumberToObject(d, "ms", r.inferMs);
    return o;
}
static void statusResult(cJSON* result, const char* note = nullptr, bool isError = false) {
    cJSON* o = statusJson();
    if (note && *note) cJSON_AddStringToObject(o, "note", note);
    char* s = cJSON_PrintUnformatted(o);
    cJSON_Delete(o);
    textResult(result, s ? s : "{\"error\":\"no memory\"}", isError || !s);
    free(s);
}
static cJSON* detectionsJson() {
    det::Result r = det::latest();
    cJSON* o = cJSON_CreateObject();
    cJSON_AddBoolToObject(o, "on", det::enabled());
    cJSON_AddNumberToObject(o, "seq", r.seq);
    cJSON_AddNumberToObject(o, "age", r.tsUs ? (double)((esp_timer_get_time() - r.tsUs) / 1000) : -1);
    cJSON_AddNumberToObject(o, "ms", r.inferMs);
    cJSON_AddNumberToObject(o, "w", r.w);
    cJSON_AddNumberToObject(o, "h", r.h);
    cJSON* arr = cJSON_AddArrayToObject(o, "objects");
    for (const auto& b : r.boxes) {
        cJSON* j = cJSON_CreateObject();
        cJSON_AddStringToObject(j, "name", det::className(b.cls));
        cJSON_AddNumberToObject(j, "score", (double)((int)(b.score * 100)) / 100);
        int box[4] = {b.x0, b.y0, b.x1, b.y1};
        cJSON_AddItemToObject(j, "box", cJSON_CreateIntArray(box, 4));
        cJSON_AddItemToArray(arr, j);
    }
    return o;
}

// Runs a tool; returns false when the name is unknown. lamp_photo is handled by the caller (its answer is big).
static const char* const CAM_TOOLS[] = {"lamp_camera", "lamp_photo", "lamp_search", "lamp_detector", "lamp_detections"};
static const char* NO_CAMERA = "{\"error\":\"this lamp has no camera module\"}";
static bool callTool(const char* name, const cJSON* args, cJSON* result) {
    const cJSON* v;
    if (!cam::present()) for (const char* t : CAM_TOOLS) if (strcmp(name, t) == 0) { textResult(result, NO_CAMERA, true); return true; }
    if (strcmp(name, "lamp_status") == 0) { statusResult(result); return true; }
    if (strcmp(name, "lamp_pose") == 0) {
        float q[servo::NJ];
        bool has[servo::NJ];
        bool any = false;
        for (int j = 0; j < servo::NJ; j++) {
            v = cJSON_GetObjectItem(args, servo::joint(j).name);
            has[j] = cJSON_IsNumber(v);
            q[j] = has[j] ? (float)v->valuedouble : 0;
            any |= has[j];
        }
        const cJSON *sp = cJSON_GetObjectItem(args, "speed"), *ac = cJSON_GetObjectItem(args, "acc");
        bool sa = cJSON_IsNumber(sp) || cJSON_IsNumber(ac);
        if (!any && !sa) { textResult(result, "{\"error\":\"no joint given\"}", true); return true; }
        servo::setSpeedAcc(cJSON_IsNumber(sp) ? sp->valueint : -1, cJSON_IsNumber(ac) ? ac->valueint : -1);
        bool wasOn = servo::torque();
        if (any) {
            search::setOn(false);                                             // a pose takes over from the search
            if (!servo::setPose(q, has)) { statusResult(result, "pose refused: the shade rim would come below 15 mm from the desk; nothing moved", true); return true; }
        }
        statusResult(result, wasOn ? "" : "motors are off: nothing moves. lamp_torque on holds the arm where it is (the target is dropped), so send the pose again after it");
        return true;
    }
    if (strcmp(name, "lamp_action") == 0) {
        v = cJSON_GetObjectItem(args, "name");
        const char* a = cJSON_IsString(v) ? v->valuestring : "";
        if (strcmp(a, "stop") == 0) a = "";
        bool wasOn = servo::torque();
        search::setOn(false);                                                 // an action takes over from the search
        if (!servo::startAction(a)) { textResult(result, "{\"error\":\"unknown gesture\"}", true); return true; }
        statusResult(result, *a == 0 ? "gesture stopped" : (wasOn ? "gesture started" : "gesture started, but the motors are off: only the light plays until lamp_torque on"));
        return true;
    }
    if (strcmp(name, "lamp_light") == 0) {
        web::applyLed(args);                                                  // mode, color, color2, bri, spd, w, aim, eye, ct: the same as POST /api/led
        bool okIdle = true;
        if (cJSON_IsString(v = cJSON_GetObjectItem(args, "idle"))) okIdle = light::setIdle(v->valuestring, !cJSON_HasObjectItem(args, "mode"));
        statusResult(result, okIdle ? "" : "unknown idle look", !okIdle);
        return true;
    }
    if (strcmp(name, "lamp_torque") == 0) {
        v = cJSON_GetObjectItem(args, "on");
        if (!cJSON_IsBool(v)) { textResult(result, "{\"error\":\"on must be true or false\"}", true); return true; }
        bool on = cJSON_IsTrue(v);
        if (!on) search::setOn(false);                                        // the search would move the head during the move to the default pose
        bool here = !on && servo::inSafePose();
        servo::setTorque(on);
        statusResult(result, on ? "" : here ? "a safe pose: the motors are off where the arm is" : "going to the default pose desk, the motors switch off when it is reached");
        return true;
    }
    if (strcmp(name, "lamp_hold_test") == 0) {
        double sec = cJSON_IsNumber(v = cJSON_GetObjectItem(args, "seconds")) ? v->valuedouble : 5.0;
        double maxDeg = cJSON_IsNumber(v = cJSON_GetObjectItem(args, "maxDeg")) ? v->valuedouble : 2.0;
        search::setOn(false);                                                 // the search would move the head
        if (!servo::holdTest((float)maxDeg, (uint32_t)(sec * 1000))) {
            statusResult(result, (std::string("hold test refused: ") + servo::holdRefusal() + "; nothing changed").c_str(), true);
            return true;
        }
        web::waitHold();
        servo::Hold h = servo::hold();
        statusResult(result, h.tripped == -1 ? "held: the arm stood still with the motors off, they are on again"
                             : h.tripped >= 0 ? "moved: a joint gave way, the motors caught it and are on again where the arm is now"
                                              : "cancelled by a torque switch");
        return true;
    }
    if (strcmp(name, "lamp_camera") == 0) {
        if (cJSON_IsBool(v = cJSON_GetObjectItem(args, "on"))) {
            if (cJSON_IsTrue(v)) cam::start();
            else { search::setOn(false); det::setEnabled(false); cam::stop(); }
        }
        bool h = cam::hflip(), f = cam::vflip(), anyFlip = false;
        if (cJSON_IsBool(v = cJSON_GetObjectItem(args, "hflip"))) { h = cJSON_IsTrue(v); anyFlip = true; }
        if (cJSON_IsBool(v = cJSON_GetObjectItem(args, "vflip"))) { f = cJSON_IsTrue(v); anyFlip = true; }
        if (anyFlip) cam::setFlip(h, f);
        if (cJSON_IsNumber(v = cJSON_GetObjectItem(args, "ae"))) cam::setAeLevel(std::min(std::max(v->valueint, -2), 2));
        statusResult(result, cam::ok() ? "" : cam::lastError()[0] ? cam::lastError() : "camera off");
        return true;
    }
    if (strcmp(name, "lamp_search") == 0) {
        v = cJSON_GetObjectItem(args, "on");
        if (!cJSON_IsBool(v)) { textResult(result, "{\"error\":\"on must be true or false\"}", true); return true; }
        bool on = cJSON_IsTrue(v), wasOn = servo::torque();
        search::setOn(on);
        statusResult(result, on ? (wasOn ? "searching: the head sweeps the desk and follows the first fruit it sees" : "search started, but the motors are off: nothing moves until lamp_torque on") : "search stopped");
        return true;
    }
    if (strcmp(name, "lamp_detector") == 0) {
        if (cJSON_IsBool(v = cJSON_GetObjectItem(args, "on"))) {
            bool on = cJSON_IsTrue(v);
            if (on && !cam::ok()) cam::start();                               // the model needs the picture
            det::setEnabled(on);
        }
        if (cJSON_IsNumber(v = cJSON_GetObjectItem(args, "thr"))) det::setThreshold((float)v->valuedouble);
        statusResult(result);
        return true;
    }
    if (strcmp(name, "lamp_detections") == 0) {
        cJSON* o = detectionsJson();
        char* s = cJSON_PrintUnformatted(o);
        cJSON_Delete(o);
        textResult(result, s ? s : "{\"error\":\"no memory\"}", !s);
        free(s);
        return true;
    }
    return false;
}

// ---------------------------------------------------------------- JSON-RPC
static void cors(httpd_req_t* req) {
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Methods", "POST, OPTIONS");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Headers", "Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version, Authorization");
}
static esp_err_t sendJson(httpd_req_t* req, cJSON* o, const char* status = "200 OK") {
    char* s = cJSON_PrintUnformatted(o);
    cJSON_Delete(o);
    if (!s) return httpd_resp_send_500(req);
    cors(req);
    httpd_resp_set_status(req, status);
    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    esp_err_t r = httpd_resp_send(req, s, HTTPD_RESP_USE_STRLEN);
    free(s);
    return r;
}
// {"jsonrpc":"2.0","id":<id>,...}: id is a copy of the request's (number or string), null when there was none
static cJSON* envelope(const cJSON* id) {
    cJSON* res = cJSON_CreateObject();
    cJSON_AddStringToObject(res, "jsonrpc", "2.0");
    cJSON_AddItemToObject(res, "id", id ? cJSON_Duplicate(id, true) : cJSON_CreateNull());
    return res;
}
static esp_err_t sendError(httpd_req_t* req, const cJSON* id, int code, const char* message, const char* status = "200 OK") {
    cJSON* res = envelope(id);
    cJSON* e = cJSON_AddObjectToObject(res, "error");
    cJSON_AddNumberToObject(e, "code", code);
    cJSON_AddStringToObject(e, "message", message);
    return sendJson(req, res, status);
}

// The photo answer is built by hand in PSRAM (a 320x240 frame is 10 to 20 kB, 27 kB as base64) and sent from there.
static esp_err_t sendPhoto(httpd_req_t* req, const cJSON* id) {
    if (!cam::present()) {
        cJSON* res = envelope(id);
        textResult(cJSON_AddObjectToObject(res, "result"), NO_CAMERA, true);
        return sendJson(req, res);
    }
    if (!cam::ok()) {
        cJSON* res = envelope(id);
        textResult(cJSON_AddObjectToObject(res, "result"),
                   cam::lastError()[0] ? "{\"error\":\"camera not running\"}" : "{\"error\":\"camera switched off: call lamp_camera with on=true first\"}", true);
        return sendJson(req, res);
    }
    uint8_t* jpg = nullptr;
    size_t jlen = 0;
    if (!cam::jpeg(&jpg, &jlen)) return sendError(req, id, -32000, "no frame from the camera", "503 Service Unavailable");
    char* idStr = cJSON_PrintUnformatted(id);
    std::string head = std::string("{\"jsonrpc\":\"2.0\",\"id\":") + (idStr ? idStr : "null") + ",\"result\":{\"content\":[{\"type\":\"image\",\"mimeType\":\"image/jpeg\",\"data\":\"";
    free(idStr);
    static const char* TAIL = "\"}]}}";
    size_t b64 = 4 * ((jlen + 2) / 3), total = head.size() + b64 + strlen(TAIL) + 1;
    char* buf = (char*)heap_caps_malloc(total, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    size_t olen = 0;
    bool ok = buf && mbedtls_base64_encode((unsigned char*)buf + head.size(), b64 + 1, &olen, jpg, jlen) == 0;
    free(jpg);
    if (!ok) { free(buf); return sendError(req, id, -32000, "no memory for the picture", "503 Service Unavailable"); }
    memcpy(buf, head.c_str(), head.size());
    memcpy(buf + head.size() + olen, TAIL, strlen(TAIL));
    size_t len = head.size() + olen + strlen(TAIL);
    cors(req);
    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    esp_err_t r = httpd_resp_send(req, buf, len);
    free(buf);
    return r;
}

static esp_err_t hPost(httpd_req_t* req) {
    if (req->content_len == 0) return sendError(req, nullptr, -32700, "empty body", "400 Bad Request");
    if (req->content_len > MAX_BODY) return sendError(req, nullptr, -32600, "body too large", "413 Payload Too Large");
    char* body = (char*)malloc(req->content_len + 1);
    if (!body) return httpd_resp_send_500(req);
    size_t got = 0;
    while (got < req->content_len) {
        int r = httpd_req_recv(req, body + got, req->content_len - got);
        if (r <= 0) { free(body); return ESP_FAIL; }
        got += r;
    }
    body[got] = 0;
    cJSON* msg = cJSON_Parse(body);
    free(body);
    if (!msg || !cJSON_IsObject(msg)) {
        bool batch = msg && cJSON_IsArray(msg);
        cJSON_Delete(msg);
        return sendError(req, nullptr, -32700, batch ? "batches are not supported" : "parse error", "400 Bad Request");
    }
    const cJSON* id = cJSON_GetObjectItem(msg, "id");
    const cJSON* m = cJSON_GetObjectItem(msg, "method");
    const char* method = cJSON_IsString(m) ? m->valuestring : "";
    if (!id || cJSON_IsNull(id)) {                                            // notifications/initialized, notifications/cancelled, ...
        cJSON_Delete(msg);
        cors(req);
        httpd_resp_set_status(req, "202 Accepted");
        return httpd_resp_send(req, nullptr, 0);
    }
    const cJSON* params = cJSON_GetObjectItem(msg, "params");
    esp_err_t ret;
    if (strcmp(method, "initialize") == 0) {
        cJSON* res = envelope(id);
        cJSON* result = cJSON_AddObjectToObject(res, "result");
        const cJSON* pv = cJSON_GetObjectItem(params, "protocolVersion");
        const char* want = cJSON_IsString(pv) ? pv->valuestring : VERSIONS[0];
        const char* give = VERSIONS[0];
        for (const char* ver : VERSIONS) if (strcmp(ver, want) == 0) give = ver;
        cJSON_AddStringToObject(result, "protocolVersion", give);
        cJSON_AddObjectToObject(cJSON_AddObjectToObject(result, "capabilities"), "tools");
        cJSON* info = cJSON_AddObjectToObject(result, "serverInfo");
        cJSON_AddStringToObject(info, "name", "nc-lamp");
        cJSON_AddStringToObject(info, "title", "NC robot desk lamp");
        cJSON_AddStringToObject(info, "version", ota::version());
        cJSON_AddStringToObject(result, "instructions", cam::present()
            ? "A robot desk lamp: a 5-joint arm with a round shade, a ring of LEDs in the shade, a camera looking out of it and a YOLO object "
              "detector on the picture. Read it with lamp_status, move it with lamp_pose or lamp_action, light it with lamp_light, make it find and "
              "follow a fruit with lamp_search, see what it sees with lamp_photo and lamp_detections. The motors must be on (lamp_torque) for "
              "anything to move. Gestures return at once and play for a few seconds; lamp_status shows action \"\" when they are done. "
              "The safe poses of lamp_action (desk, the default, rest, close, far, down, ahead, ceiling) stand by themselves with the motors off, and "
              "lamp_torque off in one of them leaves the arm there; lamp_hold_test tells it for any other pose. "
              "The camera looks out through the lit ring: for a good picture or detection turn the ring down (lamp_light bri 50 or less, "
              "or mode off), a bright ring floods the desk with its colour and washes the picture out."
            : "A robot desk lamp: a 5-joint arm with a round shade and a ring of LEDs in the shade (this lamp has no camera). Read it with "
              "lamp_status, move it with lamp_pose or lamp_action, light it with lamp_light. The motors must be on (lamp_torque) for anything "
              "to move. Gestures return at once and play for a few seconds; lamp_status shows action \"\" when they are done. "
              "The safe poses of lamp_action (desk, the default, rest, close, far, down, ahead, ceiling) stand by themselves with the motors off, and "
              "lamp_torque off in one of them leaves the arm there; lamp_hold_test tells it for any other pose.");
        ret = sendJson(req, res);
    } else if (strcmp(method, "ping") == 0) {
        cJSON* res = envelope(id);
        cJSON_AddObjectToObject(res, "result");
        ret = sendJson(req, res);
    } else if (strcmp(method, "tools/list") == 0) {
        cJSON* res = envelope(id);
        listTools(cJSON_AddObjectToObject(res, "result"));
        ret = sendJson(req, res);
    } else if (strcmp(method, "tools/call") == 0) {
        const cJSON* n = cJSON_GetObjectItem(params, "name");
        const char* name = cJSON_IsString(n) ? n->valuestring : "";
        const cJSON* args = cJSON_GetObjectItem(params, "arguments");
        ESP_LOGI(TAG, "tool %s", name);
        if (strcmp(name, "lamp_photo") == 0) {
            ret = sendPhoto(req, id);
        } else {
            cJSON* res = envelope(id);
            cJSON* result = cJSON_AddObjectToObject(res, "result");
            if (callTool(name, args, result)) ret = sendJson(req, res);
            else { cJSON_Delete(res); ret = sendError(req, id, -32602, "unknown tool"); }
        }
    } else {
        ret = sendError(req, id, -32601, "method not found");
    }
    cJSON_Delete(msg);
    return ret;
}
static esp_err_t hOptions(httpd_req_t* req) {
    cors(req);
    httpd_resp_set_status(req, "204 No Content");
    return httpd_resp_send(req, nullptr, 0);
}
static esp_err_t hOther(httpd_req_t* req) {                                   // no server-to-client stream, no sessions
    cors(req);
    httpd_resp_set_status(req, "405 Method Not Allowed");
    httpd_resp_set_hdr(req, "Allow", "POST, OPTIONS");
    httpd_resp_set_type(req, "application/json");
    return httpd_resp_sendstr(req, "{\"error\":\"POST one JSON-RPC message to /mcp\"}");
}

static void add(httpd_handle_t h, httpd_method_t m, esp_err_t (*fn)(httpd_req_t*)) {
    httpd_uri_t u = {};
    u.uri = "/mcp";
    u.method = m;
    u.handler = fn;
    httpd_register_uri_handler(h, &u);
}

void attach(httpd_handle_t server) {
    add(server, HTTP_POST, hPost);
    add(server, HTTP_OPTIONS, hOptions);
    add(server, HTTP_GET, hOther);
    add(server, HTTP_DELETE, hOther);
    ESP_LOGI(TAG, "MCP on /mcp");
}

}  // namespace mcp
