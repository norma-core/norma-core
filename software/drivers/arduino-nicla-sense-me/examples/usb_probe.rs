//! Direct hardware smoke test: cargo run -p arduino-nicla-sense-me --example usb_probe
use tokio_serial::SerialPortBuilderExt;

#[tokio::main]
async fn main() -> Result<(), String> {
    let port = arduino_nicla_sense_me::find_usb_port()
        .ok_or("no Nicla Sense ME USB device found (vid 2341 pid 0060)")?;
    println!("port: {port}");
    let mut stream = tokio_serial::new(&port, 115_200)
        .open_native_async()
        .map_err(|error| format!("failed to open {port}: {error}"))?;
    let data = arduino_nicla_sense_me::read_dump(&mut stream).await?;
    let f32_at = |offset: usize| f32::from_le_bytes(data[offset..offset + 4].try_into().unwrap());
    println!("product id:     {:#04x} (expect 0x4d)", data[0x0D]);
    println!("status:         {:#04x}", data[0x00]);
    println!("sample counter: {}", data[0x01]);
    println!("temperature:    {:.2} C", f32_at(0x70));
    println!("humidity:       {:.1} %", f32_at(0x74));
    println!("pressure:       {:.1} hPa", f32_at(0x78));
    println!("heading:        {:.1} deg", f32_at(0x64));
    Ok(())
}
