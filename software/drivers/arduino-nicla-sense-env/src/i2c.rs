use i2cdev::core::I2CDevice;
use i2cdev::linux::LinuxI2CDevice;

const MAX_I2C_BLOCK_LENGTH: usize = 32;

#[derive(Debug, Clone)]
pub(crate) struct AsyncI2cDevice {
    bus: u32,
    address: u16,
}

impl AsyncI2cDevice {
    pub(crate) fn new(bus: u32, address: u16) -> Self {
        Self { bus, address }
    }

    pub(crate) async fn read_registers(
        &self,
        start_register: u8,
        length: usize,
    ) -> Result<Vec<u8>, String> {
        let bus = self.bus;
        let address = self.address;

        tokio::task::spawn_blocking(move || {
            let mut device = open_device(bus, address)?;
            read_registers_blocking(&mut device, start_register, length)
        })
        .await
        .map_err(|error| format!("I2C read task failed: {error}"))?
    }
}

fn open_device(bus: u32, address: u16) -> Result<LinuxI2CDevice, String> {
    LinuxI2CDevice::new(format!("/dev/i2c-{bus}"), address)
        .map_err(|error| format!("failed to open /dev/i2c-{bus} address 0x{address:02x}: {error}"))
}

fn read_registers_blocking(
    device: &mut LinuxI2CDevice,
    start_register: u8,
    length: usize,
) -> Result<Vec<u8>, String> {
    let mut data = Vec::with_capacity(length);
    let mut offset = 0usize;

    while offset < length {
        let chunk_length = (length - offset).min(MAX_I2C_BLOCK_LENGTH);
        let register = start_register
            .checked_add(offset as u8)
            .ok_or_else(|| "I2C read range exceeds one-byte register space".to_string())?;
        let chunk = device
            .smbus_read_i2c_block_data(register, chunk_length as u8)
            .map_err(|error| {
                format!(
                    "failed to read {} byte(s) from register 0x{register:02x}: {error}",
                    chunk_length
                )
            })?;

        if chunk.len() != chunk_length {
            return Err(format!(
                "short I2C read from register 0x{register:02x}: expected {}, got {}",
                chunk_length,
                chunk.len()
            ));
        }

        data.extend_from_slice(&chunk);
        offset += chunk_length;
    }

    Ok(data)
}
