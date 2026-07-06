use bytes::Bytes;
use i2cdev::core::{I2CDevice, I2CMessage, I2CTransfer};
use i2cdev::linux::{LinuxI2CDevice, LinuxI2CError, LinuxI2CMessage};

const MAX_I2C_BLOCK_LENGTH: usize = 32;

#[derive(Debug, Clone, Copy)]
pub struct AsyncI2cDevice {
    bus: u32,
    address: u16,
}

impl AsyncI2cDevice {
    pub fn new(bus: u32, address: u16) -> Self {
        Self { bus, address }
    }

    pub fn bus(&self) -> u32 {
        self.bus
    }

    pub fn address(&self) -> u16 {
        self.address
    }

    pub async fn read_smbus_byte_data(&self, register: u8) -> Result<u8, String> {
        let bus = self.bus;
        let address = self.address;

        tokio::task::spawn_blocking(move || {
            let mut device = open_device(bus, address)?;
            device.smbus_read_byte_data(register).map_err(|error| {
                format!("failed to read byte from register 0x{register:02x}: {error}")
            })
        })
        .await
        .map_err(|error| format!("I2C read task failed: {error}"))?
    }

    pub async fn write_smbus_byte_data(&self, register: u8, value: u8) -> Result<(), String> {
        let bus = self.bus;
        let address = self.address;

        tokio::task::spawn_blocking(move || {
            let mut device = open_device(bus, address)?;
            device
                .smbus_write_byte_data(register, value)
                .map_err(|error| {
                    format!(
                        "failed to write byte 0x{value:02x} to register 0x{register:02x}: {error}"
                    )
                })
        })
        .await
        .map_err(|error| format!("I2C write task failed: {error}"))?
    }

    pub async fn read_smbus_i2c_block_registers(
        &self,
        start_register: u8,
        length: usize,
    ) -> Result<Bytes, String> {
        let bus = self.bus;
        let address = self.address;

        tokio::task::spawn_blocking(move || {
            let mut device = open_device(bus, address)?;
            read_smbus_i2c_block_registers_blocking(&mut device, start_register, length)
        })
        .await
        .map_err(|error| format!("I2C read task failed: {error}"))?
    }

    pub async fn read_register_bytes(&self, register: u8, length: usize) -> Result<Bytes, String> {
        let bus = self.bus;
        let address = self.address;

        tokio::task::spawn_blocking(move || {
            let mut device = open_device(bus, address)?;
            read_register_bytes_blocking(&mut device, register, length)
        })
        .await
        .map_err(|error| format!("I2C read task failed: {error}"))?
    }

    pub async fn read_register_bytes_bulk(
        &self,
        registers: Vec<u8>,
        length: usize,
    ) -> Result<Vec<(u8, Result<Bytes, String>)>, String> {
        let bus = self.bus;
        let address = self.address;

        tokio::task::spawn_blocking(move || {
            let mut device = open_device(bus, address)?;
            Ok(registers
                .into_iter()
                .map(|register| {
                    let result = read_register_bytes_blocking(&mut device, register, length);
                    (register, result)
                })
                .collect())
        })
        .await
        .map_err(|error| format!("I2C read task failed: {error}"))?
    }
}

fn open_device(bus: u32, address: u16) -> Result<LinuxI2CDevice, String> {
    let path = format!("/dev/i2c-{bus}");
    match LinuxI2CDevice::new(&path, address) {
        Ok(device) => Ok(device),
        Err(error) if is_busy_error(&error) => {
            // Matches the existing BQ24190 behavior: allow reads from devices
            // already claimed by a kernel driver.
            unsafe { LinuxI2CDevice::force_new(&path, address) }.map_err(|force_error| {
                format!("failed to force-open {path} address 0x{address:02x}: {force_error}")
            })
        }
        Err(error) => Err(format!(
            "failed to open {path} address 0x{address:02x}: {error}"
        )),
    }
}

fn is_busy_error(error: &LinuxI2CError) -> bool {
    matches!(error, LinuxI2CError::Errno(errno) if *errno == libc::EBUSY)
}

fn read_smbus_i2c_block_registers_blocking(
    device: &mut LinuxI2CDevice,
    start_register: u8,
    length: usize,
) -> Result<Bytes, String> {
    let mut data = Vec::with_capacity(length);
    let mut offset = 0usize;

    while offset < length {
        let chunk_length = (length - offset).min(MAX_I2C_BLOCK_LENGTH);
        let register = u8::try_from(offset)
            .ok()
            .and_then(|offset| start_register.checked_add(offset))
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

    Ok(Bytes::from(data))
}

fn read_register_bytes_blocking(
    device: &mut LinuxI2CDevice,
    register: u8,
    length: usize,
) -> Result<Bytes, String> {
    let register_bytes = [register];
    let mut data = vec![0; length];
    {
        let mut messages = [
            LinuxI2CMessage::write(&register_bytes),
            LinuxI2CMessage::read(&mut data),
        ];
        device.transfer(&mut messages).map_err(|error| {
            format!("failed to read {length} byte(s) from register 0x{register:02x}: {error}")
        })?;
    }

    Ok(Bytes::from(data))
}
