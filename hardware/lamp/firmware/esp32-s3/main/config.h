#pragma once
// NC lamp head firmware: Seeed XIAO ESP32-S3 (the Sense model with its camera is optional). Everything tunable is here.
//
// Settings that differ from lamp to lamp (Wi-Fi, whether the camera module is fitted, the strip layout, the time zone)
// can be put in main/local_config.h, which git ignores: copy local_config.example.h to local_config.h and edit it.
// A value defined there wins over the default below. (HAVE_LOCAL_CONFIG comes from main/CMakeLists.txt, which
// watches for the file so that creating it makes everything recompile.)
#if defined(HAVE_LOCAL_CONFIG) || __has_include("local_config.h")
#include "local_config.h"
#endif

// ---- Wi-Fi: station first, own access point if the network is not there in WIFI_STA_TIMEOUT_MS -------------------
#ifndef WIFI_STA_SSID
#define WIFI_STA_SSID        "your-wifi"           // put the real name and password in local_config.h
#endif
#ifndef WIFI_STA_PASS
#define WIFI_STA_PASS        "your-password"
#endif
#ifndef WIFI_AP_SSID
#define WIFI_AP_SSID         "nc-lamp"             // the fall-back access point
#endif
#ifndef WIFI_AP_PASS
#define WIFI_AP_PASS         "nclamp123"           // >= 8 chars, or "" for an open AP
#endif
#define WIFI_STA_TIMEOUT_MS  15000
#define WIFI_AP_RESTART_MS   300000              // on the access point with no client for this long: reboot and try the home network again
#ifndef MDNS_NAME
#define MDNS_NAME            "nc-lamp"             // http://nc-lamp.local
#endif
#ifndef WIFI_HOSTNAME
#define WIFI_HOSTNAME        "nc-lamp"             // the name the router's device list shows (DHCP hostname)
#endif

// ---- Camera: the Sense module's sensor (sold as OV2640, some report OV3660) on Seeed's pins (CAMERA_MODEL_XIAO_ESP32S3)
// CAM_ENABLED 0 (the default): no camera module is fitted. The camera, the YOLO detector and the fruit search are then
// switched off: the model is not loaded, the web page shows no camera card, the MCP server lists no camera tools.
// Set it to 1 in local_config.h for a XIAO ESP32-S3 Sense with its camera board.
#ifndef CAM_ENABLED
#define CAM_ENABLED    0
#endif
#define CAM_PIN_PWDN   -1
#define CAM_PIN_RESET  -1
#define CAM_PIN_XCLK   10
#define CAM_PIN_SIOD   40
#define CAM_PIN_SIOC   39
#define CAM_PIN_D7     48
#define CAM_PIN_D6     11
#define CAM_PIN_D5     12
#define CAM_PIN_D4     14
#define CAM_PIN_D3     16
#define CAM_PIN_D2     18
#define CAM_PIN_D1     17
#define CAM_PIN_D0     15
#define CAM_PIN_VSYNC  38
#define CAM_PIN_HREF   47
#define CAM_PIN_PCLK   13
#define CAM_XCLK_HZ    20000000
// The sensor runs in RGB565 so the detector gets pixels without a JPEG decode; the stream re-encodes them.
// FRAMESIZE_QVGA (320 x 240, 150 kB a frame, ~25 ms to encode) or FRAMESIZE_VGA (640 x 480, 600 kB, ~90 ms).
#define CAM_FRAMESIZE  FRAMESIZE_QVGA
#define OTA_TEST_CRASH 0                           // 1: crash on purpose at boot, before the firmware is confirmed, to test the fall-back (never commit 1)
#define OTA_VERIFY_WAIT_MS 15000                   // a new firmware is confirmed once the model has loaded (2 s after boot), or after this long at most
#define CAM_ON_AT_BOOT 0                           // 0: the camera stays off until the search, /api/cam?on=1 or the page's Camera button needs it (cool, dark head)
#define CAM_JPEG_Q     80                          // 0..100 for the re-encoder (higher = better picture, bigger frames)
#ifndef CAM_HFLIP
#define CAM_HFLIP      0                           // mirror / flip if the board sits the other way round (also /api/cam)
#endif
#ifndef CAM_VFLIP
#define CAM_VFLIP      0
#endif
#define CAM_AE_LEVEL   0                           // exposure target -2..2 (also /api/cam?ae=-1)
// The sensor delivers RGB565 with the high byte first. Flip this (or /api/detect?be=0) if the picture colours are
// right in the stream but the detector finds nothing: the stream converter and the model read the bytes separately.
#define CAM_RGB565_BIG_ENDIAN 1

// ---- Detector (needs the camera) ---------------------------------------------------------------------------------
#define DET_ON_AT_BOOT  0                          // the model is loaded at boot, it runs only when the search or /api/detect?on=1 asks
#define DET_SCORE_THR   0.35f                      // keep boxes with at least this confidence (model default 0.25)
#define DET_NMS_THR     0.7f
#define DET_TASK_STACK  12288
#define DET_TASK_PRIO   2
#define DET_TASK_CORE   1                          // Wi-Fi and the web servers live on core 0

// ---- Web ------------------------------------------------------------------------------------------------------------
#define WEB_PORT        80                         // page and /api
#define STREAM_PORT     81                         // MJPEG /stream on its own server task (a stream blocks its server)
#define STREAM_MAX_FPS  5                          // pace the stream: at 11 fps the JPEG encoding slows the model from 1.4 s to 5.4 s

// ---- Light: WS2812B strip in the mouth ring ---------------------------------------------------------------------------
// XIAO D2 = GPIO3 -> 330 ohm -> strip DIN; strip 5 V from the buck on plate A, GND common with the XIAO.
#define LED_PIN        3
#ifndef LED_COUNT
#define LED_COUNT      48
#endif
#ifndef LED_START_DEG
#define LED_START_DEG  270                         // where the strip's first LED sits, clock degrees seen from the front (0 = top, 90 = right): right after the cut edge where the wires enter
#endif
#ifndef LED_DIR
#define LED_DIR        1                           // +1 clockwise from there, -1 counter-clockwise
#endif
#define LED_MAX_BRI    153                         // 60 % cap: 48 LEDs at full white would draw about 2.9 A from the 5 V buck
#define LED_FPS        30
#define LED_ROLL_SIGN  -1                          // follow / eye: flip if the lit sector swings while the head rolls
#ifndef CLOCK_TZ
#define CLOCK_TZ       "UTC0"                      // POSIX zone for the clock effect, e.g. "CET-1CEST,M3.5.0,M10.5.0/3" or "<+04>-4"
#endif
#define NTP_SERVER     "pool.ntp.org"

// ---- Servo bus: 5 x ST3215 through the Seeed Bus Servo Driver Board (plate A) --------------------------------------
// The XIAO plugs into the board; its D6 (GPIO43, TX) and D7 (GPIO44, RX) reach the bus through the board's buffer.
// Nothing to wire for the bus. UART1 is used (UART0 would be these pins' default, but the console is on USB).
#define BUS_UART       UART_NUM_1
#define BUS_TX         43
#define BUS_RX         44
#define BUS_BAUD       1000000
// Joints: URDF convention (shoulder 90 = pointing up), 2048 ticks = the init pose on every servo (stored in the servos'
// own correction register with "Set this pose as init"), limits from the URDF pose sweep.
//            name        id  sign  centre  min    max
#define JOINT_TABLE \
  X("yaw",      1,  -1,   0.0f, -90.0f,  90.0f) \
  X("shoulder", 2,  +1,  90.0f,  35.0f, 135.0f) \
  X("elbow",    3,  +1,   0.0f, -80.0f,  40.0f) \
  X("wrist",    4,  +1,   0.0f, -30.0f, 100.0f) \
  X("roll",     5,  -1,   0.0f, -80.0f,  80.0f)
#define TICKS_PER_DEG  (4096.0f / 360.0f)
#define DEFAULT_SPEED  900                         // ticks/s for slider moves (ST3215 max about 3400 at 12 V)
#define DEFAULT_ACC    40                          // 0..254, x100 ticks/s^2
#define TELEMETRY_MS   100                         // every servo polled per tick (about 1 ms each)
// The default pose "desk": head over the base at 404 mm looking 50 deg down at the desk, the best balanced of the
// measured safe poses (every joint load 0). The lamp goes there after every gesture and before torque off from a pose
// that is not safe. REST_POSE is the folded pose, the "rest" action.
#define DEFAULT_POSE   0.0f, 110.0f, -40.0f, -30.0f, 0.0f
#define REST_POSE      0.0f, 133.0f, -78.0f, -15.0f, 0.0f
#define DEFAULT_MS     2500                        // how long the move to the default pose takes
#define FLOOR_MM       15.0f                       // poses that would bring the shade rim below this height are refused
#define HOLD_FLOOR_MM  40.0f                       // the hold test (motors off where the arm is) is refused closer to the desk: a joint that gives way moves a few degrees before the motors catch it
#define HOLD_MAX_MS    15000                       // the longest hold test; the HTTP / MCP call waits for the result
#define HOLD_MAX_DEG   4.0f                        // the widest trip: 8 deg let the shoulder drop fast enough to tip the lamp over
#define HOLD_MAX_LOAD  50                          // the test is refused when the shoulder already works harder than this with the motors on: measured, the gearbox holds up to about 48 and the pose falls from 56

// ---- Search: find a fruit on the table, point the head at it, follow it (search.cpp, /api/search, page "Search") ---
// Needs the camera. Sweep: the head goes up and looks down at the table (SEARCH_POSE), stops at each yaw in
// SEARCH_YAWS and waits for SEARCH_DWELL fresh detections; the ring runs the "search" radar. A fruit: its colour on the
// ring (several fruits: sectors), the head comes down to SEARCH_FOUND_POSE and keeps the fruit in the middle of the
// picture with yaw and wrist. Exactly one other known object (furniture ignored): the same, in SEARCH_OTHER_COLOR.
// Nothing: "nothing" light for SEARCH_RETRY_S, then the sweep again.
#define SEARCH_POSE        105.0f, -75.0f, -5.0f     // shoulder, elbow, wrist: head as high as the shoulder goes, camera 65 deg below the horizon
#define SEARCH_FOUND_POSE  90.0f, -65.0f, 0.0f       // a little lower than the sweep, camera 65 deg down (the close fixed-focus camera sees a lower head worse)
#define SEARCH_YAWS        {-30.0f, 0.0f, 30.0f}      // the cover hole leaves a 45 deg circle of picture: stops 30 deg apart overlap a little
#define SEARCH_DWELL       3                          // fresh detections per stop (about 1.5 s each), after the 2 skipped ones: exposure and white balance need a moment after a move
#define SEARCH_RETRY_S     5
#define SEARCH_LOST        5                          // detections without the target before the sweep starts again
#define SEARCH_GAIN        0.6f                       // share of the pixel error corrected per detection
#define SEARCH_DEADBAND    10                         // px from the centre where the head holds still
#define SEARCH_MAX_STEP    8.0f                       // deg per detection
#define CAM_HFOV_DEG       66.0f                      // horizontal field of view of the stock lens
// How the picture moves per +1 deg of a joint, px (x right, y down), measured at SEARCH_FOUND_POSE with a banana:
// the camera sits turned about 70 deg in the head, so a wrist step moves the picture mostly sideways.
// The centring solves yaw and wrist together from these two vectors (re-measure after moving the camera).
#define SEARCH_YAW_PX      {-3.3f, -3.7f}             // yaw +10 deg: box went 33 px left, 37 px up
#define SEARCH_WRIST_PX    {-3.8f,  1.3f}             // wrist +10 deg: box went 38 px left, 13 px down
//                 name      class  colour on the ring (priority order: the first one found is the one pointed at)
#define SEARCH_FRUITS \
  X("banana",  46, 255, 210,   0) \
  X("apple",   47,  20, 255,  40) \
  X("carrot",  51, 255, 110,   0)
#define SEARCH_IGNORE      {56, 57, 58, 59, 60, 61}   // chair, couch, potted plant, bed, dining table, toilet: always in view
#define SEARCH_OTHER_COLOR {170, 60, 255}             // violet: one known non-fruit object
#define SEARCH_FRUIT_THR   0.20f                      // a fruit counts from this score while the search runs (the model threshold drops to it): a whole banana in the middle scores 0.5..0.8, a yellow-green apple 0.2..0.5, a ghost "banana" at the dark rim 0.1..0.26
#define SEARCH_CONFIRM     2                          // ... but it must be seen in this many of the last 3 detections before the head goes to it (ghosts flicker; a yellow apple shows in about every other frame)
#define SEARCH_FOUND_BRI   50                         // ring brightness while following: the fruit colour at 150 floods the table, the camera's white balance fights it and the banana scores 0.3 instead of 0.8
#define SEARCH_OTHER_THR   0.50f                      // another object needs this much: ghost "suitcase" / "cat" boxes sit at 0.2..0.3
