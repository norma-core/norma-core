#pragma once
#include <cstddef>
#include <cstdint>

// The Sense camera in RGB565. One owner at a time: every call here takes the camera lock, grabs the newest frame, copies or
// encodes it and gives the frame back, so the stream and the detector never hold the driver's buffers at the same time.
// The camera module is optional (CAM_ENABLED in config.h): without it present() is false, start() always fails and
// everything else answers as for a camera that is off.
namespace cam {
bool present();               // CAM_ENABLED: a camera module is fitted to this lamp
bool begin();                 // the lock; starts the sensor only with CAM_ON_AT_BOOT
bool start();                 // power the sensor and take the frame buffers (30 kB DMA RAM + 2 frames in PSRAM); true if it runs
void stop();                  // release them again: the head runs cooler and darker
bool ok();
const char* lastError();      // why the last start() failed, "" if it worked
int width();
int height();
size_t frameBytes();                                       // width * height * 2
bool copyFrame(uint8_t* dst, int64_t* timestampUs);       // newest frame as RGB565 into dst (frameBytes() long)
bool jpeg(uint8_t** out, size_t* len);                    // newest frame as JPEG; free(*out) when done
bool encodeRgb565(const uint8_t* rgb565, int w, int h, uint8_t** out, size_t* len);   // any buffer -> JPEG; free(*out)
void setFlip(bool hflip, bool vflip);
void setAeLevel(int level);   // -2..2 exposure target
int aeLevel();
bool hflip();
bool vflip();
float fps();                                               // frames handed out per second (stream + detector)
}
