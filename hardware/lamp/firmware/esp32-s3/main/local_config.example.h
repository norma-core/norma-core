#pragma once
// Per-lamp settings. Copy this file to main/local_config.h (git ignores that name) and edit it; config.h includes it
// and takes every value defined here over its own default. Only the settings below are meant to be changed per lamp.

// Your Wi-Fi. Without it the lamp opens its own access point (WIFI_AP_SSID / WIFI_AP_PASS in config.h).
#define WIFI_STA_SSID   "your-wifi"
#define WIFI_STA_PASS   "your-password"

// 1 = a XIAO ESP32-S3 Sense with the camera board fitted (camera, YOLO detector, fruit search). 0 = no camera.
#define CAM_ENABLED     0

// Names on the network: http://<MDNS_NAME>.local and the DHCP hostname the router's device list shows.
#define MDNS_NAME       "nc-lamp"
#define WIFI_HOSTNAME   "nc-lamp"

// The ring: where the strip's first LED sits (clock degrees seen from the front, 0 = top, 90 = right) and which way
// the strip runs from there (+1 clockwise, -1 counter-clockwise). Check with the "comet" light: it must run clockwise.
#define LED_COUNT       48
#define LED_START_DEG   270
#define LED_DIR         1

// POSIX time zone for the clock light, e.g. "CET-1CEST,M3.5.0,M10.5.0/3" (central Europe), "<+04>-4" (UTC+4, no DST).
#define CLOCK_TZ        "UTC0"

// Mirror / flip the camera picture if the board sits the other way round (also the page's Mirror / Flip buttons).
// #define CAM_HFLIP    0
// #define CAM_VFLIP    0
