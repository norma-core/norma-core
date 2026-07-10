# Meet ElRobot

![Cost](https://img.shields.io/badge/cost-~$220_per_arm-green)
![Print Time](https://img.shields.io/badge/print-28.5h_(both_arms)-orange)
![DOF](https://img.shields.io/badge/DOF-7+1-blue)
![Weight](https://img.shields.io/badge/weight-800g-lightgrey)

<p>
  <img src="images/elrobot.gif" alt="action" height="200" style="display:inline-block; margin-right:8px;">
  <img src="images/elrobot-1.jpg" alt="preview" height="200" style="display:inline-block; margin-right:8px;">
</p>

🎥 **[Watch the Introduction Video →](https://youtu.be/WXRG1KnzKv4)**

🎮 **[Try the Web Playground →](https://normacore.dev/elrobot-urdf/)**

A highly affordable, fully 3D-printed robotic arm for physical AI research and imitation learning.

## ✨ Why ElRobot?

- ⚙️ **Fully 3D printed** - No custom hardware, just print and add servos
- 🦾 **7+1 DOF** - Full dexterity for complex tasks
- 🧠 **Built for AI** - Ideal for physical AI research & imitation learning
- 💰 **Affordable** - ~$220 per arm
- 🚀 **Easy to build** - Complete assembly manual & ready-to-print files

## 🚀 Quick Start

1. **[🖨️ Print](#️-3d-printing)** - Download .3mf files and print the parts
2. **[🔧 Assemble](#-assembly)** - Follow the assembly manual
3. **[🎉 Enjoy](#-community)** - Join the community and start building!

## 📋 Quick Specs

| | |
|---|---|
| **Reach** | 430 mm |
| **DOF** | 7+1 |
| **Weight** | ~800g |
| **Estimated cost** | ~$220 per arm |

# 🛠️ Bill of Materials (BOM)

The Follower and Leader arms share a core architecture but differ in their motors, power requirements, and teleoperation accessories.

### Motors & Control Systems
| Part | Leader Qty | Follower Qty | Unit Cost | Links / Notes |
| :--- | :---: | :---: | :---: | :--- |
| **ST3215 Servo (12V/30kg)** | — | **8** | ~$22.00 | **Follower Motors.** [SeeedStudio](https://www.seeedstudio.com/STS3215-30KG-Serial-Servo-p-6340.html)<br>📦 **AliExpress (Note: Sold in 6-packs):** You need **8 motors**, so you must **buy two 6-packs** (leaving 4 spares). [Opt 1](https://aliexpress.com/item/1005009270126951.html) / [Opt 2](https://aliexpress.com/item/1005009339011602.html) / [Opt 3](https://aliexpress.com/item/1005009400013739.html) |
| **ST3215 Servo (7.4V)** | **8** | — | ~$20.00 | **Leader Motors.** High back-drivability. **Choose one:**<br>**ST-3215-C044 (1:191):** Better rigidity and form retention - [SeeedStudio](https://www.seeedstudio.com/Feetech-ST-3215-C044-Heavy-Duty-Servo-7-4V-1-191-Gear-Reduction-p-6460.html)<br>**ST-3215-C046 (1:147):** Easier to control but less rigid - [SeeedStudio](https://www.seeedstudio.com/Feetech-ST-3215-C046-Standard-Torque-Servo-7-4V-1-147-Gear-Reduction-p-6461.html) / [AliExpress](https://aliexpress.com/item/1005010480778514.html) |
| **Serial Bus Servo Driver** | **1** | **1** | ~$5.00 | [Waveshare](https://www.waveshare.com/bus-servo-adapter-a.htm)<br>Alt: [SeeedStudio XIAO](https://www.seeedstudio.com/Bus-Servo-Driver-Board-for-XIAO-p-6413.html) (requires 5.5×2.1mm DC socket with wires) |

### Power & Connectivity
| Part | Leader Qty | Follower Qty | Unit Cost | Links / Notes |
| :--- | :---: | :---: | :---: | :--- |
| **12V/4A DC PSU** | — | **1** | ~$8.00 | 5.5×2.1mm DC jack - [Waveshare](https://www.waveshare.com/psu-12v4a-5.5-2.1.htm) |
| **5V/3A DC PSU** | **1** | — | ~$5.00 | 5.5×2.1mm DC jack - [Waveshare](https://www.waveshare.com/psu-5v-4a-5.5-2.1-us.htm) |
| **Active USB Hub** | **1** | — | ~$24.00 | [Amazon EU Example](https://amzn.eu/d/0212jMNd)<br>*See Hardware & Design Notes* |
| **USB Cables** | **1** | **1** | ~$5.00 | USB-C Data Cables (*See connection notes*) |

### Vision & Mounting
| Part | Leader Qty | Follower Qty | Unit Cost | Links / Notes |
| :--- | :---: | :---: | :---: | :--- |
| **Arm Camera Module** | — | **1** | ~$19.00 | [Amazon EU Example](https://amzn.eu/d/06SQPpOn) / [Amazon US Example](https://www.amazon.com/innomaker-Computer-Raspberry-Support-Windows/dp/B0CNCSFQC1/) |
| **Table Camera** | — | **1** | ~$9.00 | [Amazon EU Example](https://amzn.eu/d/0fsBAyZn) / [Amazon US Example](https://www.amazon.com/Logitech-Webcam-Widescreen-Calling-Recording/dp/B003PAOAWG) |
| **Clamps** | **2** | **2** | ~$10.00 | Optional mounting hardware |

## 📝 Hardware & Design Notes

### USB Hub & Power Distribution
* **Active USB Hub:** An externally powered hub is **required primarily for the cameras**. High-frame-rate video feeds draw significant current that can overwhelm a PC or SBC's (like Raspberry Pi) onboard ports.
* **Driver Boards:** Note that the Serial Bus Servo Driver boards **do not consume USB power** for the motors; they only use the USB connection for data signals. The motors are powered directly via the external DC power supplies.
* **Camera Compatibility:** The cameras listed in the BOM are **examples**. Any standard UVC-compatible USB camera will work with this system.

### Optimized Gear Ratios for the Leader Arm
To ensure the Leader Arm provides a natural "feel," we utilize servos with lower gear reductions (**1:147 or 1:191**).
* **Follower Arm:** Uses standard 30kg servos which create significant internal friction, making manual movement feel "notchy."
* **Leader Arm:** Lower ratios allow for high **back-drivability**. This ensures the operator can move the master arm with minimal resistance, facilitating the precise motor control needed for teleoperation.

### USB Cables
Ensure all USB cables are rated for **data transfer**. Power-only "charging" cables will prevent the computer from recognizing the driver boards. Use **USB-C to USB-A** for hub connections or **USB-C to USB-C/USB-A** for direct PC connections.

---

# 🖨️ 3D Printing
- **Filament needed (leader):** ~320g PLA (13.5h print time)

- **Filament needed (follower):** ~360g PLA (16h print time)

  ![printing](./images/printing.png)

## For Bambulab / Orca Slicer Users

Simply download the pre-configured .3mf file and start printing:

| Profile                                    | Link                                        | Print Time (Leader + Follower) |
|--------------------------------------------|---------------------------------------------|--------------------------------|
| **PLA Only (Recommended)**                 | [.3mf](print/basic/elrobot_full_basic.3mf)  | 29.5h                          |
| AMS Single Nozzle (PLA + PETG supports)    | [.3mf](print/ams/elrobot_full_ams.3mf)      | 42.5h on A1/P2S                |
| AMS Dual Nozzle (PLA + PETG supports)      | [.3mf](print/ams/elrobot_full_ams_dual.3mf) | 32h on H2D                     |

**Before printing:**
- **Camera mount:** The .3mf files include 3 different camera mounts. Choose the one that fits your camera and delete the others before slicing.
- **Driver enclosure:** Optional. Choose the enclosure that fits your servo driver board (Waveshare or SeeedStudio) or remove if not needed.
- **PETG supports:** Using PETG supports (AMS profiles) improves surfaces finish but doesn't affect performance.

## For Other Printers (Advanced)

This project works with any well-calibrated FDM printer. Use the STL files for manual slicing.

### 🛠 Pre-Print Checklist
Before you start, ensure your machine is ready for precision parts:
- **Calibration:** Verify your E-steps/Flow rate.
- **Bed Leveling:** Ensure a perfect first layer to prevent warping.
- **Hardware:** Designed for a 0.4mm nozzle at 0.2mm layer height.

### 📂 STL Files
STL files are located in the [/STL](./STL) folder:
- `elrobot_follower/`: Combined parts for the follower unit.
- `elrobot_leader/`: Combined parts for the leader unit.
- `case_for_seedstudio/`: Enclosure for the SeeedStudio driver board.
- `case_for_waveshare/`: Enclosure for the Waveshare driver board.
- `gripper_camera_mounts/`: Camera mounts for the gripper.

*Note: Combined STL files are exported in the optimal printing orientation.*

### 🖨 Slicing Guide
| File              | Wall Count | Supports | Brim |
|-------------------|------------|----------|------|
| panels.stl        | Default    | No       | No   |
| regular_parts.stl | Default    | Tree     | Auto |
| strong_parts.stl  | 6          | Yes      | Yes  |

---

## 🔧 Assembly

**You'll need:**
- PH1 and PH2 screwdrivers
- All BOM components listed above

**Assembly Manuals:**
- 👉 **[Follower Arm Manual](manual-follower.pdf)** - Complete assembly guide
- 👉 **[Leader Arm Manual](manual-leader.pdf)** - Shows only the different steps (uses parts of follower manual)

### 📷 Camera Mounts

Modular camera mounts snap onto the gripper — pick the one that fits your camera and swap anytime.

| Camera | Mount                                                | Photo                                                  |
|--------|------------------------------------------------------|--------------------------------------------------------|
| Innomaker U20CAM-1080P (27mm holes) | [STL](STL/gripper_camera_mounts/CameraMount_square_27mm.stl) | <img src="images/cameras/u20.png" height="100px">      |
| Innomaker Day&Night Vision (34mm holes) | [STL](STL/gripper_camera_mounts/CameraMount_square_34mm.stl) | <img src="images/cameras/nv.png" height="100px">       |
| Generic webcam | [STL](STL/gripper_camera_mounts/CameraMount_regular.stl)     | <img src="images/cameras/generic.png" height="100px">  |


## 📁 Source Files

| Type | Link |
|------|------|
| STL | [/STL](./STL) |
| STEP | [/STEP](./STEP) |
| URDF | [/simulation](./simulation) |

## 📜 Attribution

This project incorporates the following components from the [**SO-ARM100**](https://github.com/TheRobotStudio/SO-ARM100) robot arm design:
- Handle_SO101
- Trigger_SO101
- Wrist_Roll_SO101

## 🌐 Community

**Website:** [normacore.dev](https://normacore.dev)

**Follow us:**
- 🐦 [X/Twitter](https://x.com/norma_core_dev)
- 🎥 [YouTube](https://www.youtube.com/@normacoredev)
- 💼 [LinkedIn](https://www.linkedin.com/company/normacore/)
- 📢 [Reddit](https://www.reddit.com/r/NormaCore/)

**Join & Contribute:**
- 💬 [Discord](https://discord.gg/Z4Ytw3QfHP) - Chat with the community
- 🐙 [GitHub](https://github.com/norma-core/norma-core) - Source code & issues