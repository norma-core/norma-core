#pragma once
// WS2812 ring effects. Each effect is a pure function (i, n, t, params) -> RGB, the same code as the demo page.
#include <Arduino.h>
#include <Adafruit_NeoPixel.h>
#include "config.h"

namespace leds {

enum Mode : uint8_t { OFF, SOLID, BREATHE, RAINBOW, COMET, CHASE, SCANNER, SPARKLE, FIRE, FOLLOW, REACTIVE, NMODES };
static const char* MODE_NAMES[NMODES] = { "off", "solid", "breathe", "rainbow", "comet", "chase", "scanner", "sparkle", "fire", "follow", "reactive" };

struct RGB { float r, g, b; };
struct Params {
  Mode mode = SPARKLE;
  RGB c1 = { 255, 177, 92 }, c2 = { 0, 0, 0 };
  uint8_t bri = 150, spd = 40, w = 6;
  uint16_t ct = 6500;          // white balance, Kelvin: 6500 = the strip as it is, lower = warmer, higher = cooler
  float aim = 90;              // follow: lit sector angle in the room (clock deg seen from the front: 0 top, 90 right, with roll 0)
  float roll = 0;              // head roll (deg) for follow
  float motion = 0, dir = 1;   // reactive: 0..1 how fast the lamp moves (measured), and which way (+1 clockwise)
};

static inline RGB mix(RGB a, RGB b, float k) { return { a.r + (b.r - a.r) * k, a.g + (b.g - a.g) * k, a.b + (b.b - a.b) * k }; }
static inline RGB scale(RGB c, float k) { return { c.r * k, c.g * k, c.b * k }; }
static inline float wrapDist(float a, float b, int n) { float d = fmodf(fabsf(a - b), n); return min(d, n - d); }
static inline float frand() { return (float)esp_random() / 4294967296.0f; }
static RGB hsv(float h, float s, float v) {
  h -= floorf(h); int i = (int)(h * 6); float f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  float r, g, b;
  switch (i % 6) { case 0: r = v; g = t; b = p; break; case 1: r = q; g = v; b = p; break; case 2: r = p; g = v; b = t; break;
                   case 3: r = p; g = q; b = v; break; case 4: r = t; g = p; b = v; break; default: r = v; g = p; b = q; }
  return { r * 255, g * 255, b * 255 };
}

class Ring {
 public:
  Params p;
  Ring() : strip(LED_COUNT, LED_PIN, NEO_GRB + NEO_KHZ800) {}
  void begin() { strip.begin(); strip.show(); }
  bool setMode(const char* name) {
    for (int k = 0; k < NMODES; k++) if (strcmp(MODE_NAMES[k], name) == 0) { p.mode = (Mode)k; return true; }
    return false;
  }
  const char* modeName() const { return MODE_NAMES[p.mode]; }

  // One frame at time t (s). Index i is the clock layout (0 at the top, clockwise seen from the front); the
  // physical LED for it follows from where the strip starts (LED_START_DEG) and which way it runs (LED_DIR).
  // The copy for the web page keeps the clock order.
  void render(float t) {
    const int n = LED_COUNT;
    const int start = (int)lroundf(LED_START_DEG * n / 360.0f);
    float dt = lastT > 0 ? min(t - lastT, 0.1f) : 0; lastT = t;
    if (p.ct != wbCt) { wb = whiteBalance(p.ct); wbCt = p.ct; }
    phase = fmodf(phase + dt * p.spd * 0.6f * p.motion * p.dir + n, n);     // reactive comet: runs only while the lamp moves
    // reactive: `act` 1 = the moving look, 0 = the idle sparkle. Up in about 0.1 s on any movement, down over
    // about a second once the lamp has rested for REACTIVE_IDLE_S.
    if (p.motion > 0.05f) { lastMove = t; act += (1 - act) * min(1.0f, dt * 10); }
    else if (t - lastMove > REACTIVE_IDLE_S) act += (0 - act) * min(1.0f, dt * 1.2f);
    float k = min((int)p.bri, LED_MAX_BRI) / 255.0f;
    for (int i = 0; i < n; i++) {
      RGB c = pixel(i, n, t);
      uint8_t r = constrain((int)(c.r * k * wb.r), 0, 255), g = constrain((int)(c.g * k * wb.g), 0, 255), b = constrain((int)(c.b * k * wb.b), 0, 255);
      frame[i * 3] = r; frame[i * 3 + 1] = g; frame[i * 3 + 2] = b;
      int phys = ((LED_DIR > 0 ? i - start : start - i) % n + n) % n;
      strip.setPixelColor(phys, r, g, b);
    }
    strip.show();
  }
  uint8_t frame[LED_COUNT * 3] = { 0 };

 private:
  Adafruit_NeoPixel strip;
  float sparkle[LED_COUNT] = { 0 }, heat[LED_COUNT] = { 0 };
  float phase = 0, lastT = 0, act = 0, lastMove = 0;
  static constexpr float REACTIVE_IDLE_S = 4, REACTIVE_IDLE_BRI = 0.6f;

  RGB sparklePx(int i, int n) {
    if (frand() < 0.012f * p.spd / n) sparkle[i] = 1;
    sparkle[i] *= 0.9f;
    return mix(scale(p.c2, 0.12f), p.c1, sparkle[i]);
  }
  RGB wb = { 1, 1, 1 }; uint16_t wbCt = 0;

  // Channel gains for a white point of `kelvin`, relative to the strip's own white (6500): the black-body
  // colour (Tanner Helland's fit) divided by the colour at 6500, scaled so no gain exceeds 1.
  static RGB blackBody(float kelvin) {
    float t = kelvin / 100, r, g, b;
    if (t <= 66) { r = 255; g = 99.4708f * logf(t) - 161.1196f; b = t <= 19 ? 0 : 138.5177f * logf(t - 10) - 305.0448f; }
    else { r = 329.6987f * powf(t - 60, -0.1332f); g = 288.1222f * powf(t - 60, -0.0755f); b = 255; }
    return { constrain(r, 0.0f, 255.0f), constrain(g, 0.0f, 255.0f), constrain(b, 0.0f, 255.0f) };
  }
  static RGB whiteBalance(uint16_t kelvin) {
    RGB w = blackBody(kelvin), n = blackBody(6500);
    RGB g = { w.r / n.r, w.g / n.g, w.b / n.b };
    float m = max(g.r, max(g.g, g.b));
    return { g.r / m, g.g / m, g.b / m };
  }

  RGB pixel(int i, int n, float t) {
    switch (p.mode) {
      case OFF: return { 0, 0, 0 };
      case SOLID: return p.c1;
      case BREATHE: return scale(p.c1, 0.15f + 0.85f * (0.5f - 0.5f * cosf(t * p.spd * 0.08f)));
      case RAINBOW: return hsv((float)i / n + t * p.spd * 0.004f, 1, 1);
      case COMET: { float head = fmodf(t * p.spd * 0.3f, n); float d = fmodf(head - i + n, n); float a = max(0.0f, 1 - d / (p.w * 2)); return scale(p.c1, a * a); }
      case CHASE: { float k = fmodf(i + t * p.spd * 0.15f, p.w * 2.0f); return k < p.w ? p.c1 : scale(p.c2, 0.25f); }
      case SCANNER: { float c = n / 2.0f + (n / 2.0f - 1) * sinf(t * p.spd * 0.04f); return scale(p.c1, powf(max(0.0f, 1 - wrapDist(i, c, n) / p.w), 1.5f)); }
      case SPARKLE: return sparklePx(i, n);
      case FIRE: {
        heat[i] = max(0.0f, heat[i] - frand() * 0.06f * p.spd / 40);
        if (frand() < 0.08f) heat[i] = min(1.0f, heat[i] + frand() * 0.8f);
        float h = (heat[i] + heat[(i + 1) % n] + heat[(i + n - 1) % n]) / 3;
        return h < 0.5f ? mix({ 20, 0, 0 }, { 255, 60, 0 }, h * 2) : mix({ 255, 60, 0 }, { 255, 220, 120 }, (h - 0.5f) * 2);
      }
      // follow: the sector stays where it is in the room: the head roll is taken out of the aim.
      case FOLLOW: { float a = fmodf(fmodf(p.aim - LED_ROLL_SIGN * p.roll, 360) + 360, 360); return scale(p.c1, powf(max(0.0f, 1 - wrapDist(i, a * n / 360, n) / p.w), 1.5f)); }
      // reactive: a dim glow of the main colour that brightens with movement, plus a comet (second colour, or the
      // main colour when the second is black) that runs round the ring with the movement and stops with it.
      // After REACTIVE_IDLE_S at rest it fades into the sparkle pattern at REACTIVE_IDLE_BRI; movement brings
      // the glow back at once.
      case REACTIVE: {
        RGB sp = scale(sparklePx(i, n), REACTIVE_IDLE_BRI);      // always stepped, so its state is live when it shows
        bool c2black = p.c2.r + p.c2.g + p.c2.b < 1;
        RGB glow = scale(p.c1, 0.06f + 0.24f * p.motion);
        float d = wrapDist(i, phase, n);
        float comet = p.motion * max(0.0f, 1 - d / (p.w * 1.5f));
        return mix(sp, mix(glow, c2black ? p.c1 : p.c2, comet * comet), act);
      }
      default: return { 0, 0, 0 };
    }
  }
};

}  // namespace leds
