#pragma once
#include <cstdint>
#include <string>

// WS2812 ring in the shade, ported from firmware/espcam leds.h: each effect is a pure function (i, n, t, params) ->
// RGB, rendered LED_FPS times a second by its own task through the RMT peripheral (espressif/led_strip).
// Index 0 is 12 o'clock seen from the front, clockwise; the physical order follows LED_START_DEG / LED_DIR.
namespace light {
// search: a cyan radar sweep (the lamp is looking); nothing: a slow dim red breath (nothing found); parts: the ring
// in equal sectors of the colours given with setParts() (one sector per fruit found).
// idle looks (2026-11-01): aurora = green / teal / violet curtains drifting round the ring; stars = cold-white stars
// twinkling on near-black with a shooting star now and then; mood = the sparkle effect with a colour that drifts round
// the hue circle in about four minutes. (A candle look was tried and dropped the same day.)
enum Mode : uint8_t { OFF, SOLID, BREATHE, RAINBOW, COMET, CHASE, SCANNER, SPARKLE, FIRE, FOLLOW, REACTIVE, CLOCK, EYE, SEARCH, NOTHING, PARTS, AURORA, STARS, MOOD, UPDATE, NMODES };
// update: the firmware upload as a progress bar, blue filling clockwise from 12 o'clock (progress 0..1, from the OTA module)
struct RGB { float r, g, b; };
struct Params {
    Mode mode = CLOCK;
    RGB c1 = {255, 177, 92}, c2 = {0, 0, 0};
    uint8_t bri = 100, spd = 40, w = 6;
    uint16_t ct = 6500;        // white balance, Kelvin: 6500 = the strip as it is, lower = warmer
    float aim = 90;            // follow: lit sector angle in the room (clock deg seen from the front, roll 0)
    float roll = 0;            // head roll (deg), fed by the servo module
    float motion = 0, dir = 1; // reactive: 0..1 how fast the lamp moves, and which way (+1 clockwise)
    float tod = -1;            // clock: local time of day in seconds, negative while the lamp has no time
    float eye = 1;             // eye: how far the lids are open, 0 shut .. 1 wide
    float progress = 0;        // update: how much of the image has arrived, 0..1 (fed by the OTA module)
};
extern const RGB CLOCK_HOUR, CLOCK_MINUTE, CLOCK_SECOND;

bool begin();                               // strip driver, white balance and idle mode from flash, render task
bool ok();
Params get();                               // copy of the current parameters (thread safe)
void set(const Params& p);                  // replace them
bool setMode(const char* name);
const char* modeName(Mode m);
int modeCount();
void setMotion(float motion, float dir, float roll);   // from the servo module, 50 times a second
void setParts(const RGB* cols, int n);                 // colours for the "parts" mode, 1..4 sectors
void setProgress(float p);                             // update mode: 0..1
void flash(RGB c, int times);                          // the whole ring blinks c `times` (250 ms on, 250 ms off) over the running mode
extern const RGB GREEN, RED;                           // for the flashes: boot confirmed / rolled back, upload failed
void saveWhiteBalance();                    // ct to flash (called once the slider rests)
std::string frameHex();                     // the current frame as rrggbb per LED, clock order, for the page
// The idle mode: what the ring shows at power-on and after a search. Saved in flash; "random" picks one of the other
// choices at every boot (and whenever it is set).
bool setIdle(const char* name, bool apply); // one of idleChoice(); apply = show it now too; false if unknown
const char* idleSetting();                  // as saved: "aurora", ..., "random"
const char* idleMode();                     // the mode it resolved to this boot
int idleChoiceCount();
const char* idleChoice(int k);
bool hasTime();                             // the clock has been set (NTP)
std::string clockStr();                     // "HH:MM:SS" local, or ""
}
