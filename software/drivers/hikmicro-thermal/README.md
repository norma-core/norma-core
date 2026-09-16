# HIKMICRO thermal acquisition

Enable `drivers.hikmicro-thermal.enabled: true` in the configuration passed to
station. The Linux driver discovers USB `2bdf:0102` and publishes
`hikmicro-thermal/<serial>`. The generic USB video driver excludes vendor `2bdf`.

## Production flow

1. Discover through libuvc and register the thermal queue.
2. Open through libusb, claim control interface 0 (detach the kernel driver if
   needed), and prime extension-unit 10 selectors 1–6.
3. Write `03 0e` to selector 5. Read selector 3's length header, then its chunks
   using GET_LEN/GET_CUR. Extract the factory blob from the returned container.
4. Release the control interface and reattach its kernel driver. Publish device
   information with calibration status. Failed calibration permits raw imagery;
   it cannot produce calibrated Celsius readings.
5. Open through libuvc, select YUYV 256×196 at 25 FPS by descriptor dimensions,
   then probe, commit and start the stream. Publish the negotiated format/frame
   indices in frame envelopes; these indices differ between camera models.
6. Poll at 200 ms intervals. Wait up to `frame-timeout` (default 5 seconds) for
   complete payloads. Publish the retained frames with their calibration data.
7. The viewer reads the first 98304 bytes as 256×192 little-endian detector
   counts and the following 2048 bytes as runtime calibration state. It combines
   these with the 14336-byte factory blob to calculate per-pixel Celsius values.

This is not the TC001 `raw / 64 - 273.15` wire format.

## Camera EA6343104 flow audit (2026-09-10)

The successful standalone experiment used the kernel V4L2 interface, captured
25 frames, and then retrieved calibration using UVC extension-unit ioctls.
That proves the camera protocol and payload decoding, but it does **not** test
station's libusb/libuvc access, calibration-before-stream ordering, queue
publication or live UI delivery.

Observed camera facts:

- USB `2bdf:0102`, firmware descriptor `4.09`, serial `EA6343104`.
- Compact 256×196 stream at descriptor index **6**, format index 1, 25 FPS.
- Complete payload size 100352 bytes, runtime marker `aabbccdd`, dimensions 256×192.
- Calibration container 14404 bytes, factory blob at offset 68, length 14336.
- Replaying captured frames 0, 12 and 24 through the actual viewer's
  `renderThermalFrame` succeeds with `usedCalibration=true` and `error=null`.
  Frame 24 yields min 27.078125°C, max 28.59375°C, center 27.546875°C, matching
  the standalone Go decoder. This checks decoder agreement, not physical accuracy.

The audit corrected a hardcoded **metadata** frame index of 2; stream negotiation
already selected by dimensions, so that metadata bug alone does not explain a
failure to capture. It also corrected successful empty polls being treated as
out-of-memory errors, rejected calibration chunks that cannot advance the read,
and added explicit calibration/negotiation/first-frame diagnostics.

The working kernel ioctl probe needed a 512-byte GET_CUR buffer because Linux
caches the control size while this camera changes GET_LEN responses during the
calibration transaction. This requirement must not be copied blindly into the
direct libusb path, which does not use that kernel control cache.

The remaining live failure is not yet reproduced: the camera was disconnected
during this audit. No firmware update or new temperature formula is established
as necessary by the saved data.

## Verify the production acquisition sequence

With exactly one camera connected and no competing capture process:

```sh
cargo test -p hikmicro-thermal camera_calibration_and_compact_stream -- --ignored --nocapture
```

This opt-in hardware test uses the production discovery, calibration and stream
functions in their production order and requires ten complete frames with valid
runtime metadata. It fails at the relevant acquisition stage. It does not test
NormFS publication or the viewer connection.

Optionally set `HIKMICRO_PROBE_OUT` to a new directory to save the last frame and
its matching camera calibration for decoder replay. Direct libusb access requires
read/write permission on `/dev/bus/usb/<bus>/<device>`; access to `/dev/videoN`
alone does not establish this.
