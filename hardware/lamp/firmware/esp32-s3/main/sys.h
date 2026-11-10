#pragma once
#include <cstdint>

// Chip housekeeping: internal temperature sensor, uptime, memory.
namespace sys {
void begin();
bool temperature(float* celsius);   // false if the sensor is not available
uint32_t uptimeS();
uint32_t freeHeap();                // internal RAM, bytes
uint32_t largestDmaBlock();         // the biggest piece of it that DMA can use (the camera needs one of CONFIG_CAMERA_DMA_BUFFER_SIZE_MAX)
uint32_t freePsram();
uint32_t totalPsram();
// Boot report: why the chip last reset and how far the previous boot got (a breadcrumb in RTC memory that survives a
// panic or a watchdog reset). stage(n) is called along app_main; lastStage() is what the previous boot reached.
void stage(int n);
int lastStage();
void note(int n);              // a second breadcrumb for the detector task (61 loading, 62 loaded)
int lastNote();
const char* resetReason();
}
