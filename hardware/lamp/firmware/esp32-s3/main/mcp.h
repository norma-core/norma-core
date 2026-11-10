#pragma once
#include "esp_http_server.h"

// MCP server (Model Context Protocol, Streamable HTTP transport) on the page's port, ported from firmware/espcam
// mcp.cpp (2026-11-01): POST /mcp takes one JSON-RPC 2.0 message and answers with plain JSON (no SSE stream, no
// session), so any MCP client that speaks the HTTP transport can drive the lamp directly:
//   claude mcp add --transport http lamp http://nc-lamp.local/mcp
// The tools wrap the REST API: lamp_status, lamp_pose, lamp_action, lamp_light, lamp_torque, lamp_camera, lamp_photo,
// lamp_search (find and follow a fruit), lamp_detector and lamp_detections (the YOLO boxes). The lamp modules are
// called directly (servo::, light::, search::, cam::, det::); the status JSON and the light-field parsing come from web.cpp.
namespace mcp {
void attach(httpd_handle_t server);   // registers /mcp: POST and OPTIONS; GET and DELETE answer 405
}
