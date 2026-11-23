#pragma once
// ---- Wi-Fi ----------------------------------------------------------------
// Station first; if the network is not reachable within WIFI_STA_TIMEOUT_MS the lamp opens its own access point.
#define WIFI_STA_SSID        "YOUR_WIFI_SSID"
#define WIFI_STA_PASS        "YOUR_WIFI_PASSWORD"
#define WIFI_AP_SSID         "nc-lamp"
#define WIFI_AP_PASS         "nclamp123"            // >= 8 chars, or "" for an open AP
#define WIFI_STA_TIMEOUT_MS  15000
#define MDNS_NAME            "lamp"                 // http://lamp.local, OTA target lamp.local:3232

// ---- Pins (AI-Thinker ESP32-CAM, no SD card) ------------------------------
// Free pins are 2, 4 (flash LED), 12 (boot strap, avoid), 13, 14, 15. UART0 (1, 3) stays for the programmer.
// Waveshare Bus Servo Adapter (A): header labelled from the HOST side, so TX goes to TX and RX to RX, NOT crossed.
// Jumper block: two caps on "A" (header pair joined to the middle pair). The adapter does not echo. 3.3 V logic is fine.
#define BUS_TX        14      // ESP32 TX -> adapter "TXD"
#define BUS_RX        15      // ESP32 RX <- adapter "RXD"
#define BUS_BAUD      1000000
#define LED_PIN       13      // -> 330 ohm -> strip DIN
#define LED_COUNT     47      // WS2812B 144/m around the mouth ring (counted 2026-10-12)
// Where the strip's first LED (the input end) sits and which way the strip runs, seen from the FRONT of the lamp
// (looking into the shade), in clock degrees: 0 = 12 o'clock, 90 = 3 o'clock, 180 = 6 o'clock. The effects and
// the page always use the clock layout (index 0 at the top, clockwise), the physical order is derived.
#define LED_START_DEG 180     // lamp 2 (2026-10-13): the strip starts at the bottom
#define LED_DIR       -1      // +1: the strip runs clockwise from there, -1: counter-clockwise (lamp 2)
#define LED_MAX_BRI   153     // 60 % cap: 51 LEDs at full white would draw about 3 A from the 5 V buck
#define LED_FPS       30
#define LED_ROLL_SIGN -1      // follow: flip if the lit sector swings around while the head rolls (lamp 2: -1, checked 2026-10-13)

// ---- Joints (URDF convention: shoulder 90 = pointing up, 2048 = the init pose) ------------
// Servo signs were verified by jogging on 2026-10-12. Limits are the URDF pose-sweep limits.
//            name        id  sign  centre  min    max
#define JOINT_TABLE \
  X("yaw",      1,  -1,   0.0f, -90.0f,  90.0f) \
  X("shoulder", 2,  +1,  90.0f,  35.0f, 105.0f) \
  X("elbow",    3,  +1,   0.0f, -80.0f,  40.0f) \
  X("wrist",    4,  +1,   0.0f, -30.0f, 100.0f) \
  X("roll",     5,  -1,   0.0f, -80.0f,  80.0f)

#define TICKS_PER_DEG   (4096.0f / 360.0f)
#define DEFAULT_SPEED   900     // ticks/s for slider moves (ST3215 max about 3400 at 12 V)
#define DEFAULT_ACC     40      // 0..254, x100 ticks/s^2
#define TELEMETRY_MS    100     // every servo polled per tick (about 1 ms each), status pushed over the WebSocket every tick
#define FLOOR_MM        15.0f   // poses that would bring the shade rim below this height are refused
