#pragma once
#include "esp_http_server.h"

// Over-the-air update: POST the app binary (build/nc_lamp.bin, raw body) to /update. The image goes into the
// other app slot, the lamp reboots into it, and main() marks it valid once everything has started; if the new app
// crashes before that, the bootloader goes back to the previous one (CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE).
namespace ota {
const char* version();            // from version.txt, baked into the app
const char* runningSlot();        // "ota_0" / "ota_1"
bool pendingVerify();             // true on the first boot of a freshly uploaded app
void markValid();                 // keep this app, cancel the rollback
bool busy();                      // an upload is running
int progressPercent();            // -1 when idle
bool rolledBack();                // this boot is the old app again because the new one crashed during its first start
esp_err_t handleUpdate(httpd_req_t* req);   // the /update handler (POST)
}
