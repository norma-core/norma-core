//! Diagnostic: dump raw bytes from the Nicla USB CDC port for 15 seconds
//! (firmware boot markers, MbedOS fault dumps, stray prints).
//! cargo run -p arduino-nicla-sense-me --example serial_monitor
use tokio::io::AsyncReadExt;
use tokio_serial::{SerialPort, SerialPortBuilderExt};

#[tokio::main]
async fn main() -> Result<(), String> {
    let port = arduino_nicla_sense_me::find_usb_port()
        .ok_or("no Nicla Sense ME USB device found (vid 2341 pid 0060)")?;
    println!("monitoring {port} for 15s...");
    let mut stream = tokio_serial::new(&port, 115_200)
        .open_native_async()
        .map_err(|error| format!("failed to open {port}: {error}"))?;
    stream
        .write_data_terminal_ready(true)
        .map_err(|error| format!("failed to assert DTR: {error}"))?;

    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(15);
    let mut buffer = [0u8; 256];
    let mut total = 0usize;
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            break;
        }
        match tokio::time::timeout(remaining, stream.read(&mut buffer)).await {
            Ok(Ok(0)) => break,
            Ok(Ok(n)) => {
                total += n;
                let text: String = buffer[..n]
                    .iter()
                    .map(|&b| {
                        if (32..=126).contains(&b) || b == b'\n' || b == b'\r' {
                            b as char
                        } else {
                            '.'
                        }
                    })
                    .collect();
                print!("{text}");
            }
            Ok(Err(error)) => return Err(format!("read error: {error}")),
            Err(_) => break,
        }
    }
    println!("\n--- {total} bytes total ---");
    Ok(())
}
