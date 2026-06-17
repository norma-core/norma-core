# 🤖 NormaCore.Dev Station

Physical operations platform for robotics - real-time data collection, inference integration, and robot control.

## 📥 Download

**Latest Release: [v0.1.0-beta.8](https://github.com/norma-core/norma-core/releases/tag/v0.1.0-beta.8)**

Download pre-built binaries from the [releases page](https://github.com/norma-core/norma-core/releases/tag/v0.1.0-beta.8):

- **macOS ARM64** (Apple Silicon): `station-macos-arm64.dmg` - Desktop app with bundled station binary
- **macOS ARM64** (Apple Silicon): `station-macos-arm64.zip` - Command-line binaries archive
- **Linux ARM64** (Raspberry Pi): `station-linux-aarch64.tar.gz`
- **Linux AMD64** (Intel/AMD): `station-linux-x86_64.tar.gz`

**macOS Desktop App:**
```bash
# Install station-macos-arm64.dmg and drag NormaCore Station to Applications
# Station binary runs automatically in the background
```

**Command-line Binaries:**
```bash
# Linux
tar -xzf station-linux-*.tar.gz
./station --web --tcp

# macOS
unzip station-macos-arm64.zip
./station --web --tcp
```

## 🚀 Quick Start

### Linux: USB Access Setup

On Linux, you need to add your user to the `dialout` group to access USB devices (servos, cameras, etc.) without sudo:

```bash
sudo usermod -a -G dialout $USER
```

Then **log out and log back in** for the group change to take effect.

### Running Station

```bash
station --web --tcp
```

Open your browser at **http://localhost:8889** to see the web interface.

![Station Web Interface](images/screenshot.png)

## 🐍 Python Examples

Control your robots with just a few lines of Python - **no dependencies needed!**

### 1. Subscribe to ST3215 Motor State Updates

Real-time access to **ALL motor registers** - complete raw state for every motor:

- **Full register dump** - All bytes of motor memory
- **Parse any register** - Position, current, temperature, voltage, torque limits, PIDs, etc.
- **Calibrated ranges** - Min/max from calibration for safe control
- **Bus metadata** - Serial number, latency, system timestamps
- **Live updates** - Subscribe over tcp

```python
import asyncio
from station_py import new_station_client
from target.gen_python.protobuf.drivers.st3215 import st3215

async def main():
    client = await new_station_client("localhost", logger)
    client.follow("st3215/inference", entries_queue)

    # Raw access to complete motor state:
    # motor.get_state() -> bytes  # ALL registers!
    # Parse any register at any address - you have full control

asyncio.run(main())
```

![ST3215 Motor State Monitor](../../shared/station_py/images/image.png)

### 2. Send Commands to Motors

Control motor positions with calibrated ranges:

```python
import asyncio
from station_py import new_station_client, send_commands
from target.gen_python.protobuf.station import commands, drivers
from target.gen_python.protobuf.drivers.st3215 import st3215

async def main():
    client = await new_station_client("localhost", logger)

    # Move motor to position
    st3215_cmd = st3215.Command(
        target_bus_serial="YOUR_BUS_SERIAL",
        write=st3215.ST3215WriteCommand(
            motor_id=1,
            address=0x2A,  # Target position register
            value=(2000).to_bytes(2, byteorder='little')
        )
    )

    cmd = commands.DriverCommand(
        type=drivers.StationCommandType.STC_ST3215_COMMAND,
        body=st3215_cmd.encode()
    )

    await send_commands(client, [cmd])

asyncio.run(main())
```

## 📚 Complete Examples

- **[SO101 Auto-Calibration (Python)](../../examples/so101-autocalibration-py/)** - Motor control workflow with state subscription and command sending
- **[SO101/ElRobot Remote Teleop (Python)](../../examples/st3215-remote-teleop-py/)** - Mirror motor positions from leader arm to follower arm across stations
- **[SmolVLA Fine-tune (Python)](../../../ai/smolvla_py/)** - Train and deploy vision-language-action policy on SO101 arm
- **[Dataset Export Guide](../../../docs/datasets/export-parquet/)** - Export Parquet datasets from station history for ML training

## ✨ Features

- 🤖 **Robot & sensor agnostic** - Works with any hardware through extensible drivers
- 💻 **Runs on any computer** - Low resource usage, works on Raspberry Pi out of the box
- 📦 **Zero-dependency** - Single binary without external libraries
- 📱 **Operate & monitor from any device** - Web-based interface accessible from phones, tablets, laptops
- 🌐 **Operate & monitor over any network** - Local or remote access via TCP/WebSocket
- 🕸️ **Sensor mesh** - Build distributed sensor networks using the API
- 🔌 **Plug & play** - Auto-detection and zero-configuration setup
- 🛡️ **Fail-safe by design** - Current limiting, automatic recovery, safe defaults
- 🔐 **Robotic data encryption** - AES-256 encryption, compression, signing with robot key and automatic key rotation
- 📜 **Full lifetime history** - Every sensor reading and command permanently stored
- 🗂️ **Automated dataset assembly** - Ready-to-use datasets for training ML models

## 🗂️ Platform & Feature Support

| Category | Feature | Status |
|----------|---------|--------|
| **Operating Systems** | macOS | ✅ Supported |
|  | Linux | ✅ Supported |
|  | Windows | 📋 Planned |
|  | FreeBSD | 📋 Planned |
| **Devices** | [UVC USB Cameras](../../../drivers/usbvideo) | ✅ Done |
|  | [SO101](../../../drivers/st3215) | ✅ Done |
|  | [ElRobot](../../../drivers/st3215) | ✅ Done |
|  | OpenArm | 🚧 Work in Progress |
|  | Yahboom Dogzilla Lite | 🚧 Work in Progress |
|  | IP Cameras | 🚧 Work in Progress |
|  | Waveshare RoArm-M2 | 📋 Planned |
|  | Yahboom ROSMASTER X3 | 📋 Planned |
| **Client Libraries** | Golang | 🚧 Work in Progress ([examples available](../../shared/station/)) |
|  | Python | 🚧 Work in Progress ([examples available](../../shared/station_py/)) |
|  | JavaScript | 📋 Planned |
|  | TypeScript | 📋 Planned |
| **Robotics Frameworks** | ROS | 📋 Planned |

**Want integration for your robot?** [Open an issue](https://github.com/norma-core/norma-core/issues) with your device details!

## 📖 Usage

```bash
station --help
```

```bash
NormaCore.Dev station: physical operations platform

Usage: station [OPTIONS]

Options:
      --max-queue-disk-size <MAX_QUEUE_DISK_SIZE>
          Maximum queue disk size in bytes [default: 2147483648]
      --normfs-base-folder <NORMFS_BASE_FOLDER>
          Base folder for normfs storage [default: ./station_data]
  -c, --config <CONFIG>
          Path to configuration file [default: station.yaml]
  -t, --tcp [<TCP>]
          Addr to listen for normfs TCP server. If provided without a value, it will listen on 0.0.0.0:8888
      --web [<WEB>]
          Addr to listen for websocket server. If provided without a value, it will listen on 0.0.0.0:8889
  -h, --help
          Print help
  -V, --version
          Print version
```

### Examples

```bash
# Run with default settings
station

# With web interface
station --web

# With custom config
station --config my-robot.yaml

# Full example
station \
  --config robot.yaml \
  --normfs-base-folder ./data \
  --max-queue-disk-size 5368709120 \
  --tcp 0.0.0.0:8888 \
  --web 0.0.0.0:8889
```

## 📝 Configuration

Station uses YAML configuration. On first run, a default `station.yaml` is created:

```yaml
drivers:
  # ST3215 servo bus
  st3215:
    enabled: true
    current-threshold: 100     # Current limit for safety (mA)
    deadband: 20               # Minimum movement threshold
    motor-current-thresholds:  # Per-motor overrides
      8: 40
      5: 60

  # System resource monitoring
  system-info: true

  # USB video capture
  usb-video:
    enabled: true
    resize-target: 224  # Resize shortest dimension to 224px

# ML inference integration
inference:
  - queue-id: "inference/normvla"
    shm: "/tmp/normvla"
    shm-size-mb: 12
    format: "normvla"
    st3215-bus: "auto"  # Auto-detect or specify bus ID
    update-interval: "100ms"

# Optional: S3-compatible cloud offload
cloud-offload:
  bucket: "my-robot-data"  # leave empty to use env: AWS_S3_BUCKET
  region: "us-east-1"  # leave empty to use env: AWS_REGION
  access_key_id: "YOUR_KEY"  # leave empty to use env: AWS_ACCESS_KEY_ID
  secret_access_key: "YOUR_SECRET"  # leave empty to use env: AWS_SECRET_ACCESS_KEY
  endpoint: "https://s3.amazonaws.com"  # Optional for MinIO/R2, leave empty to use env: AWS_ENDPOINT_URL
```

## 🌐 Web Interface

Access the web interface at `http://localhost:8889` (when `--web` is enabled):

- Real-time robot state visualization
- 3D URDF rendering
- Servo calibration tools
- Video feed monitoring
- Timeline navigation

See [station-viewer](../../clients/station-viewer) for details.

## 🔧 Building

```bash
# Building for host OS/arch
make build

# Binary location
{REPO_ROOT}/target/release/station

# Cross-compile for Linux ARM64 (e.g., Raspberry Pi)
cargo zigbuild --target aarch64-unknown-linux-gnu --release -p station

# Cross-compile for Linux AMD64 (on macOS, requires NASM)
brew install nasm  # Required for turbojpeg on macOS
cargo zigbuild --target x86_64-unknown-linux-gnu --release -p station
```

## 📖 License

MIT - See [LICENSE](../../LICENSE)
