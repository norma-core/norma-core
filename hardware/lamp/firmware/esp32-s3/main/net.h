#pragma once
#include <string>

// Wi-Fi: station on the home network, own access point as a fallback, mDNS name.
namespace net {
void begin();                 // blocks until the station has an address or the AP is up (WIFI_STA_TIMEOUT_MS at most)
bool isAp();
std::string ip();
std::string ssid();
int rssi();                   // dBm, 0 on the AP
}
