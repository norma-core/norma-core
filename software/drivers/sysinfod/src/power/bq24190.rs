use crate::sysinfo_proto::sysinfo::PowerSourceAttribute;
use std::fs;
use std::os::fd::AsRawFd;
use std::path::Path;
use std::time::Duration;

const POWER_SUPPLY_NAME: &str = "bq24190-charger";
const REG_POWER_ON_CONFIG: u8 = 0x02;
const REG_BATTERY_VOLTAGE: u8 = 0x0e;
const REG_SYSTEM_VOLTAGE: u8 = 0x0f;
const REG_BUS_VOLTAGE: u8 = 0x11;
const CONV_START: u8 = 0x80;
const CONV_RATE: u8 = 0x40;

pub(super) fn append_attributes(
    name: &str,
    path: &Path,
    attributes: &mut Vec<PowerSourceAttribute>,
) {
    if name != POWER_SUPPLY_NAME {
        return;
    }

    match read_adc(path) {
        Ok(adc) => {
            attributes.push(attribute(
                "bq24190_reg02_power_on_config_raw",
                format_register(adc.power_on_config_raw),
            ));
            attributes.push(attribute(
                "bq24190_reg0e_battery_voltage_raw",
                format_register(adc.battery_voltage_raw),
            ));
            attributes.push(attribute(
                "bq24190_reg0f_system_voltage_raw",
                format_register(adc.system_voltage_raw),
            ));
            attributes.push(attribute(
                "bq24190_reg11_bus_voltage_raw",
                format_register(adc.bus_voltage_raw),
            ));
            attributes.push(attribute(
                "bq24190_vbus_voltage_volts",
                format!("{:.3}", adc.vbus_voltage),
            ));
            attributes.push(attribute(
                "bq24190_vbat_voltage_volts",
                format!("{:.3}", adc.vbat_voltage),
            ));
            attributes.push(attribute(
                "bq24190_vsys_voltage_volts",
                format!("{:.3}", adc.vsys_voltage),
            ));
        }
        Err(err) => {
            attributes.push(attribute("bq24190_adc_error", err.to_string()));
        }
    }
}

fn format_register(value: u8) -> String {
    format!("0x{:02x}", value)
}

fn attribute(key: impl Into<String>, value: impl Into<String>) -> PowerSourceAttribute {
    PowerSourceAttribute {
        key: key.into(),
        value: value.into(),
    }
}

struct AdcReadings {
    power_on_config_raw: u8,
    battery_voltage_raw: u8,
    system_voltage_raw: u8,
    bus_voltage_raw: u8,
    vbus_voltage: f32,
    vbat_voltage: f32,
    vsys_voltage: f32,
}

fn read_adc(path: &Path) -> std::io::Result<AdcReadings> {
    let (bus, addr) = find_i2c_target_for_power_supply(path).ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "could not locate backing i2c device",
        )
    })?;

    let mut dev = LinuxSmbusDevice::open(bus, addr)?;

    let mut power_on_config_raw = dev.read_byte_data(REG_POWER_ON_CONFIG)?;
    if power_on_config_raw & CONV_RATE == 0 {
        dev.write_byte_data(
            REG_POWER_ON_CONFIG,
            power_on_config_raw | CONV_START | CONV_RATE,
        )?;
        std::thread::sleep(Duration::from_secs(1));
        power_on_config_raw = dev.read_byte_data(REG_POWER_ON_CONFIG)?;
    }

    let battery_voltage_raw = dev.read_byte_data(REG_BATTERY_VOLTAGE)?;
    let system_voltage_raw = dev.read_byte_data(REG_SYSTEM_VOLTAGE)?;
    let bus_voltage_raw = dev.read_byte_data(REG_BUS_VOLTAGE)?;

    let vbat = (battery_voltage_raw & 0x7f) as f32;
    let vsys = (system_voltage_raw & 0x7f) as f32;
    let vbus = (bus_voltage_raw & 0x7f) as f32;

    Ok(AdcReadings {
        power_on_config_raw,
        battery_voltage_raw,
        system_voltage_raw,
        bus_voltage_raw,
        vbus_voltage: vbus * 0.1 + 2.6,
        vbat_voltage: vbat * 0.02 + 2.304,
        vsys_voltage: vsys * 0.02 + 2.304,
    })
}

fn find_i2c_target_for_power_supply(path: &Path) -> Option<(u32, u16)> {
    let canonical_path = fs::canonicalize(path).ok()?;

    canonical_path
        .ancestors()
        .filter_map(|ancestor| ancestor.file_name()?.to_str())
        .find_map(parse_i2c_device_name)
}

fn parse_i2c_device_name(name: &str) -> Option<(u32, u16)> {
    let (bus, addr) = name.split_once('-')?;

    if bus.is_empty()
        || addr.is_empty()
        || !bus.chars().all(|ch| ch.is_ascii_digit())
        || !addr.chars().all(|ch| ch.is_ascii_hexdigit())
    {
        return None;
    }

    Some((bus.parse().ok()?, u16::from_str_radix(addr, 16).ok()?))
}

struct LinuxSmbusDevice {
    file: fs::File,
}

impl LinuxSmbusDevice {
    fn open(bus: u32, addr: u16) -> std::io::Result<Self> {
        let file = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(format!("/dev/i2c-{}", bus))?;

        set_i2c_slave_address(&file, addr)?;

        Ok(Self { file })
    }

    fn read_byte_data(&mut self, command: u8) -> std::io::Result<u8> {
        let mut data = I2cSmbusData { byte: 0 };
        self.smbus_access(I2C_SMBUS_READ, command, I2C_SMBUS_BYTE_DATA, &mut data)?;

        Ok(unsafe { data.byte })
    }

    fn write_byte_data(&mut self, command: u8, value: u8) -> std::io::Result<()> {
        let mut data = I2cSmbusData { byte: value };
        self.smbus_access(I2C_SMBUS_WRITE, command, I2C_SMBUS_BYTE_DATA, &mut data)
    }

    fn smbus_access(
        &mut self,
        read_write: u8,
        command: u8,
        size: u32,
        data: &mut I2cSmbusData,
    ) -> std::io::Result<()> {
        let mut args = I2cSmbusIoctlData {
            read_write,
            command,
            size,
            data,
        };

        let ret = unsafe { libc::ioctl(self.file.as_raw_fd(), I2C_SMBUS, &mut args) };
        if ret < 0 {
            return Err(std::io::Error::last_os_error());
        }

        Ok(())
    }
}

fn set_i2c_slave_address(file: &fs::File, addr: u16) -> std::io::Result<()> {
    let ret = unsafe { libc::ioctl(file.as_raw_fd(), I2C_SLAVE, libc::c_ulong::from(addr)) };
    if ret >= 0 {
        return Ok(());
    }

    let err = std::io::Error::last_os_error();
    if err.raw_os_error() != Some(libc::EBUSY) {
        return Err(err);
    }

    let ret = unsafe { libc::ioctl(file.as_raw_fd(), I2C_SLAVE_FORCE, libc::c_ulong::from(addr)) };
    if ret < 0 {
        return Err(std::io::Error::last_os_error());
    }

    Ok(())
}

#[repr(C)]
union I2cSmbusData {
    byte: u8,
    word: u16,
    block: [u8; I2C_SMBUS_BLOCK_MAX + 2],
}

#[repr(C)]
struct I2cSmbusIoctlData {
    read_write: u8,
    command: u8,
    size: u32,
    data: *mut I2cSmbusData,
}

const I2C_SLAVE: libc::c_ulong = 0x0703;
const I2C_SLAVE_FORCE: libc::c_ulong = 0x0706;
const I2C_SMBUS: libc::c_ulong = 0x0720;
const I2C_SMBUS_READ: u8 = 1;
const I2C_SMBUS_WRITE: u8 = 0;
const I2C_SMBUS_BYTE_DATA: u32 = 2;
const I2C_SMBUS_BLOCK_MAX: usize = 32;
