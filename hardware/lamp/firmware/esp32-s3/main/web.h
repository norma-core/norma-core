#pragma once

// Two HTTP servers: WEB_PORT for the page, /api/*, /jpg and /analysed.jpg; STREAM_PORT for the MJPEG /stream
// (a stream holds its server task for as long as the viewer watches).
#include "cJSON.h"
namespace web {
void begin();
cJSON* lampJson();                 // GET /api/lamp as a cJSON object (the caller deletes it); also the MCP status
void applyLed(const cJSON* d);     // the fields of POST /api/led; also the MCP tool lamp_light
void waitHold();                   // block until the running hold test is over (POST /api/hold and the MCP tool lamp_hold_test answer with the result)
}
