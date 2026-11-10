# NC lamp head firmware (ESP32-S3)

Firmware for the head of the NC robot desk lamp: a Seeed **XIAO ESP32-S3** on the Seeed Bus Servo Driver Board, driving
the five ST3215 servos and the WS2812 ring, with a web page, a REST API, an MCP server for AI clients and firmware
updates over Wi-Fi. With the **XIAO ESP32-S3 Sense** (the model with the camera board) it also runs the YOLO11n object
detector on the camera picture and can find and follow a fruit on the desk. The camera is optional and off by default
(`CAM_ENABLED`, see below).

Built with ESP-IDF 5.5. This is the release copy of `firmware/yolo`, where the development notes and measurements live.

| part | what it does |
|---|---|
| servos | 5 x ST3215 on the driver board's bus (nothing to wire). Boot never moves the arm. Pose sliders, 12 gestures (up, lookdown, reach, wake, scan, spin, bounce, no, yes, peek, warning, resolved), 7 safe poses that stand by themselves with the motors off (desk, rest, close, far, down, ahead, ceiling), torque on/off kept in flash, floor check (the shade rim stays 15 mm over the desk), hold test, "set this pose as init" calibration |
| light | WS2812B ring, 48 LEDs by default, on XIAO pin D2 (GPIO3) through a 330 ohm resistor. 19 looks (solid, breathe, rainbow, comet, clock from NTP, eye, aurora, stars, mood, ...), an idle look for power-on, white balance, upload progress bar |
| web page | `http://nc-lamp.local` (or the IP from the log): everything above with sliders and buttons, status, firmware upload |
| API | REST on port 80 (`/api/lamp`, `/api/pose`, `/api/led`, `/api/action`, `/api/torque`, `/api/hold`, `/api/idle`, `/api/status`, `/update`), MCP on `POST /mcp` |
| camera (optional) | Sense camera at 320 x 240, live MJPEG stream on port 81, snapshot, YOLO11n detector (80 COCO classes, about 1.5 s a frame), fruit search (`/api/search`, `/api/detect`, `/api/cam`, `/jpg`, `/analysed.jpg`) |
| Wi-Fi | joins your network; without it, opens the access point `nc-lamp` (password `nclamp123`) and reboots after 5 min with nobody connected to try again. mDNS name `nc-lamp.local` |
| OTA | `ota.sh` / `ota.ps1` or the page's "Upload firmware" button; two app slots, the bootloader goes back to the old firmware if the new one crashes at its first boot |

## Layout

| file | what |
|---|---|
| `main/config.h` | every setting: pins, joint table and limits, poses, light, search tuning |
| `main/local_config.example.h` | the per-lamp settings (Wi-Fi, camera yes/no, strip layout, time zone). Copy to `main/local_config.h` and edit; git ignores that file |
| `main/main.cpp` | boot order, the firmware confirmation after an update |
| `main/servo.cpp`, `light.cpp` | the arm and the ring |
| `main/web.cpp`, `web_page.h`, `mcp.cpp`, `ota.cpp`, `net.cpp`, `sys.cpp` | web server and page, MCP server, update, Wi-Fi + mDNS, temperature and boot report |
| `main/camera.cpp`, `detector.cpp`, `search.cpp` | the camera parts, inactive without `CAM_ENABLED 1` |
| `version.txt` | the version the page and `/api/status` show |
| `partitions.csv`, `sdkconfig.defaults` | 8 MB flash: two app slots of 2.56 MB and a 2.75 MB partition for the model; chip settings |
| `build.sh`, `ota.sh` | build wrapper and Wi-Fi upload for macOS and Linux (bash) |
| `build.ps1`, `ota.ps1` | the same for Windows (PowerShell) |

## 1. Set up Wi-Fi and the per-lamp settings

The Wi-Fi name and password are not in the code. Put them in a file git ignores:

```bash
cd firmware/esp32-s3
cp main/local_config.example.h main/local_config.h
```

(Windows: `copy main\local_config.example.h main\local_config.h`.) Then edit `main/local_config.h` with any editor.

In `local_config.h`:

```c
#define WIFI_STA_SSID   "your-wifi"        // your network
#define WIFI_STA_PASS   "your-password"
#define CAM_ENABLED     0                  // 1 for a XIAO ESP32-S3 Sense with the camera board
#define MDNS_NAME       "nc-lamp"          // http://nc-lamp.local
#define CLOCK_TZ        "UTC0"             // POSIX zone for the clock light, e.g. "CET-1CEST,M3.5.0,M10.5.0/3"
#define LED_START_DEG   270                // where the strip's first LED sits (clock degrees seen from the front)
#define LED_DIR         1                  // +1 = the strip runs clockwise from there
```

Every value in `local_config.h` replaces the default in `config.h`. Changing it needs a rebuild and a flash or OTA.

Without a reachable network the lamp opens its own access point after 15 s: Wi-Fi `nc-lamp`, password `nclamp123`,
page at `http://192.168.4.1`. It stays there while somebody is connected and reboots after 5 min alone to look for your
network again (so after a power cut it finds the router once the router is back). The AP name and password are
`WIFI_AP_SSID` / `WIFI_AP_PASS` in `config.h`.

## 2. Build

Needs ESP-IDF **v5.5** (v5.3 or newer works for the neural-net runtime). The wrappers `build.sh` (macOS, Linux) and
`build.ps1` (Windows) find ESP-IDF, load its environment and run `idf.py` with whatever you pass them; with nothing they
build.

**macOS / Linux**

1. Install the tools ESP-IDF needs: macOS `brew install cmake ninja dfu-util`, Debian/Ubuntu
   `sudo apt install git wget flex bison gperf python3 python3-pip python3-venv cmake ninja-build ccache libffi-dev libssl-dev dfu-util libusb-1.0-0`
   (the full list per distribution is in
   [Espressif's guide](https://docs.espressif.com/projects/esp-idf/en/v5.5/esp32s3/get-started/linux-macos-setup.html)).
2. Clone ESP-IDF and install the ESP32-S3 toolchain (about 2 GB, once):

```bash
mkdir -p ~/esp && cd ~/esp
git clone -b v5.5.1 --recursive https://github.com/espressif/esp-idf.git
~/esp/esp-idf/install.sh esp32s3
```

3. Build:

```bash
cd firmware/esp32-s3
./build.sh build
```

`build.sh` looks for ESP-IDF in `$IDF_PATH`, then `~/esp/esp-idf`; set `IDF_PATH` for another place. It sources
`export.sh` itself, so nothing has to be added to your shell profile. (The ESP-IDF VS Code extension installs to
`~/esp/v5.5/esp-idf` or similar: point `IDF_PATH` there.)

**Windows**

1. Install ESP-IDF 5.5 with Espressif's Windows installer, or clone it and run `install.ps1 esp32s3` inside it.
   The build wrapper expects it at `C:\esp\esp-idf`; set `IDF_PATH` to use another place.
2. Build from PowerShell (not from Git Bash: ESP-IDF refuses to start inside MSYS):

```powershell
cd firmware\esp32-s3
.\build.ps1 build
```

The first build downloads the components (`main/idf_component.yml`: esp32-camera, coco_detect with the YOLO11n model,
mdns, led_strip) and takes a few minutes; it needs internet once. The result is `build/nc_lamp.bin` (about 2 MB).
`dependencies.lock` records the exact component versions; the component manager re-solves it when your ESP-IDF
patch version differs from the one in the file, which is harmless.

## 3. Flash over USB (first time)

Connect the XIAO with its USB-C. It shows up as "USB Serial Device" (Espressif, VID 303A): `/dev/cu.usbmodem*` on
macOS, `/dev/ttyACM*` on Linux, a `COM` port in Device Manager on Windows.

```bash
./build.sh -p /dev/cu.usbmodem1101 flash monitor    # everything: bootloader, partitions, app, model partition
```

```powershell
.\build.ps1 -p COM11 flash monitor
```

Without `-p`, `idf.py` tries every serial port it finds, which is fine when the XIAO is the only one. On Linux your user
needs access to the port: `sudo usermod -aG dialout $USER` (Debian/Ubuntu; `uucp` on Arch) and log in again, or
`sudo chmod a+rw /dev/ttyACM0` for one session.

`monitor` shows the log: the Wi-Fi join, the address (`station address 192.168.x.y`), the servos found, `ready:`.
Leave the monitor with `Ctrl+]`.

If the port does not answer, put the chip in download mode: hold **B**, press **R**, release **B**, then flash and press
**R** again. The XIAO has no UART bridge: the log and the flashing share the chip's own USB port, nothing to jumper.

Later USB flashes can skip the 2.9 MB model partition: `./build.sh -p <port> app-flash monitor`. A full `flash` is only
needed again when `partitions.csv`, the bootloader settings in `sdkconfig.defaults` or the model change.

## 4. Update over Wi-Fi (OTA)

Once the lamp is on the network, new firmware goes over Wi-Fi in about 20 to 30 s:

```bash
./build.sh build
./ota.sh                        # nc-lamp.local
./ota.sh 192.168.1.50           # the lamp's IP, when .local does not resolve on your computer
```

(Windows: `.\build.ps1 build`, then `.\ota.ps1` or `.\ota.ps1 192.168.1.50`.) `ota.sh` is a `curl` POST of the image to
`/update`; the lamp's answer (slot, version, byte count) is printed. On Linux, `.local` names need Avahi with
`libnss-mdns` (`sudo apt install avahi-daemon libnss-mdns`); macOS and Windows resolve them out of the box.

Or open the page and use **Upload firmware…** with `build/nc_lamp.bin`.

What happens: the image goes into the free app slot, the ring fills blue clockwise as it arrives, blinks green twice
when it is written, and the lamp reboots. The new firmware is confirmed once everything (and the model, with a camera)
has started; the ring blinks green twice again. If the new firmware crashes before that, the bootloader boots the old one
again, which blinks red three times (`/api/status` shows `boot.rolledBack`). A failed upload blinks red twice and keeps
the old firmware. Only the app travels; the model partition stays as it is.

`/api/status` shows `app.version` (from `version.txt`) and `app.slot` (`ota_0` / `ota_1`); the slots alternate.

## 5. First run on the lamp

1. Torque is off after the first boot. Open the page; the sliders show the angles the servos read.
2. If the arm is new or a horn was re-seated: with torque off, pose the lamp pointing straight up by hand (arm vertical,
   head straight) and press **Set this pose as init…**. This writes the servos' own offset so that pose reads 2048 ticks.
3. **Torque on**: the motors hold the pose as found, nothing jumps. Try a small slider move, then the gesture **up**.
4. Check the ring with the **comet** light: it must run clockwise seen from the front, starting at 12 o'clock. If not,
   change `LED_START_DEG` / `LED_DIR` in `local_config.h`.
5. Pick the idle look under **At start**; it is kept in flash.

**Torque off** in a safe pose (desk, rest, close, far, down, ahead, ceiling) switches the motors off where the arm is;
anywhere else the arm goes to the default pose `desk` first. The hold test (`POST /api/hold`, MCP `lamp_hold_test`)
tells whether another pose stands by itself.

## Camera (XIAO ESP32-S3 Sense only)

Set `CAM_ENABLED 1` in `local_config.h` and rebuild. The page then shows the camera card: live stream, **Detect**,
**Camera** on/off, **Mirror** / **Flip** if the board sits the other way round, snapshot, the analysed frame with the
boxes the model drew, and the **Search fruit** button (banana, apple, carrot; the head sweeps the desk, points at the
fruit and follows it). The camera is off at boot and starts when something needs it; off, the head runs about 8 °C
cooler. With the camera running the closed head reaches 80 °C and more; the chip is rated for it, but a bright ring
floods the picture with its colour, so dim it (brightness 50 or less) for detections.

Without `CAM_ENABLED` the model is not loaded, the camera routes answer "no camera module", the page hides everything
about the camera and the MCP server does not list the camera tools. The model partition is still flashed (the
partition table is the same for both builds).

## AI clients (MCP)

The lamp is an MCP server (Streamable HTTP, one JSON-RPC message per POST, no session):

```powershell
claude mcp add --transport http lamp http://nc-lamp.local/mcp
```

Tools: `lamp_status`, `lamp_pose`, `lamp_action`, `lamp_light`, `lamp_torque`, `lamp_hold_test`, and with a camera
`lamp_camera`, `lamp_photo`, `lamp_search`, `lamp_detector`, `lamp_detections`. Every tool answers with the lamp status
and a short note.

## Good to know

- `nc-lamp.local` needs mDNS to pass between your PC and the lamp. Some routers do not forward multicast between the
  wired and the wireless side; use the IP then (give the lamp a DHCP reservation). The router's device list shows the
  lamp as `nc-lamp` (`WIFI_HOSTNAME`).
- There is no password on the page, the API or `/update`, and CORS is open: a lamp for your home network, not for the
  internet.
- Internal RAM is tight (about 75 kB free with everything running); the boot order in `main.cpp` matters. The 8 MB
  PSRAM is not the problem.
- `/api/status` `boot` says why the lamp last restarted (power on, software restart, panic, watchdog, brownout) and how
  far the previous boot got, which finds a boot problem without a serial cable.
- Serial console: 115200 on the XIAO's USB-C, `./build.sh -p <port> monitor` (Windows `.\build.ps1 -p COM11 monitor`).
