#pragma once
#include <string>

// Find and follow: sweep the table from a high pose with the "search" light, and when a fruit from SEARCH_FRUITS
// (or exactly one other known object) shows up in the detections, show its colour, come down and keep it in the
// middle of the picture with yaw and wrist. Settings in config.h (SEARCH_*). Runs on its own task; the detector
// delivers a result about every 1.5 s and every move skips the next result (that frame was grabbed before the move).
namespace search {
void begin();
void setOn(bool on);
bool on();
const char* state();                 // "off", "sweep", "nothing", "found"
std::string target();                // class name being pointed at, "" when none
int targetCls();
float targetScore();
std::string seen();                  // names of the fruits in the last detection, comma separated
int stop();                          // sweep stop index
}
