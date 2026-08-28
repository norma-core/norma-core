//! TEMP diagnostic: print quaternion, firmware euler, and accel-implied
//! attitude to localize the dashboard-cube orientation bug.
use tokio_serial::SerialPortBuilderExt;

#[tokio::main]
async fn main() -> Result<(), String> {
    let port = arduino_nicla_sense_me::find_usb_port()
        .ok_or("no Nicla Sense ME USB device found")?;
    let mut stream = tokio_serial::new(&port, 115_200)
        .open_native_async()
        .map_err(|error| format!("failed to open {port}: {error}"))?;
    let data = arduino_nicla_sense_me::read_dump(&mut stream).await?;
    let f = |off: usize| f32::from_le_bytes(data[off..off + 4].try_into().unwrap());

    let (qw, qx, qy, qz) = (f(0x50), f(0x54), f(0x58), f(0x5C));
    let (heading, pitch, roll) = (f(0x64), f(0x68), f(0x6C));
    let (ax, ay, az) = (f(0x14), f(0x18), f(0x1C));

    // Ground truth from gravity: aircraft convention (x fwd, y right, z ??):
    // pitch = asin(-ax/|a|), roll = atan2(ay, az) for z-down convention.
    let norm = (ax * ax + ay * ay + az * az).sqrt();
    let gt_pitch = (-ax / norm).asin().to_degrees();
    let gt_roll = (ay).atan2(az).to_degrees();

    println!("quat:            w={qw:+.3} x={qx:+.3} y={qy:+.3} z={qz:+.3}  |q|={:.3}",
        (qw * qw + qx * qx + qy * qy + qz * qz).sqrt());
    println!("firmware euler:  heading={heading:+.1}  pitch={pitch:+.1}  roll={roll:+.1}");
    println!("accel raw g:     x={ax:+.3} y={ay:+.3} z={az:+.3}");
    println!("gravity-implied: pitch={gt_pitch:+.1}  roll={gt_roll:+.1}   (aircraft, z-down)");
    let gt_roll_zup = (ay).atan2(-az).to_degrees();
    let gt_pitch_zup = (ax / norm).asin().to_degrees();
    println!("gravity-implied: pitch={gt_pitch_zup:+.1} roll={gt_roll_zup:+.1}   (z-up variant)");
    Ok(())
}
