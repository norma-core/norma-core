use crate::sysinfo_proto::sysinfo::PowerSourceAttribute;
use i2c_async::AsyncI2cDevice;
use std::fs;
use std::path::Path;
use std::time::Duration;

const POWER_SUPPLY_NAME: &str = "bq24190-charger";
const REG_POWER_ON_CONFIG: u8 = 0x02;
const REG_BATTERY_VOLTAGE: u8 = 0x0e;
const REG_SYSTEM_VOLTAGE: u8 = 0x0f;
const REG_BUS_VOLTAGE: u8 = 0x11;
const CONV_START: u8 = 0x80;
const CONV_RATE: u8 = 0x40;

pub(super) async fn append_attributes(
    name: &str,
    path: &Path,
    attributes: &mut Vec<PowerSourceAttribute>,
) {
    if name != POWER_SUPPLY_NAME {
        return;
    }

    match read_adc(path).await {
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

async fn read_adc(path: &Path) -> Result<AdcReadings, String> {
    let (bus, addr) = find_i2c_target_for_power_supply(path)
        .ok_or_else(|| "could not locate backing i2c device".to_string())?;

    let dev = AsyncI2cDevice::new(bus, addr);

    let mut power_on_config_raw = dev.read_smbus_byte_data(REG_POWER_ON_CONFIG).await?;
    if power_on_config_raw & CONV_RATE == 0 {
        dev.write_smbus_byte_data(
            REG_POWER_ON_CONFIG,
            power_on_config_raw | CONV_START | CONV_RATE,
        )
        .await?;
        tokio::time::sleep(Duration::from_secs(1)).await;
        power_on_config_raw = dev.read_smbus_byte_data(REG_POWER_ON_CONFIG).await?;
    }

    let battery_voltage_raw = dev.read_smbus_byte_data(REG_BATTERY_VOLTAGE).await?;
    let system_voltage_raw = dev.read_smbus_byte_data(REG_SYSTEM_VOLTAGE).await?;
    let bus_voltage_raw = dev.read_smbus_byte_data(REG_BUS_VOLTAGE).await?;

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
