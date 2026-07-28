use crate::dfrobot_rs485_proto::DfrobotSensorModel;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum SensorModel {
    /// SEN0640 photoelectric solar radiation, W/m²
    Irradiance,
    /// SEN0641 photosynthetically active radiation, µmol/m²·s
    Par,
    /// SEN0642 UV intensity + index
    Uv,
    /// SEN0644 ambient light, Lux (32-bit)
    Light,
}

// Poll plans: (start_register, register_count), documented + undocumented-live
// registers from the hardware-verified register maps
// (~/projects/study/tmp/dfrobot/REGISTERS.md). Contiguous ranges keep the
// transaction count low; unimplemented registers inside a range read as 0 on
// these devices, which is harmless. To poll a new register later, extend or
// add a range here — storage is self-describing, nothing else changes.
const IRRADIANCE_RANGES: &[(u16, u16)] = &[
    (0x0000, 2), // 0x0000 value W/m², 0x0001 undocumented (derived)
    (0x0009, 1), // undocumented, static — model/hardware id?
    (0x0010, 1), // undocumented (derived)
    (0x0052, 1), // deviation setting
    (0x07D0, 5), // address, baud, 0x07D2 (unused), 0x07D3/0x07D4 serial pair
];

const PAR_RANGES: &[(u16, u16)] = &[
    (0x0000, 4), // 0x0000 value µmol/m²·s, 0x0003 undocumented raw ADC
    (0x0009, 1),
    (0x0052, 1), // deviation setting (signed)
    (0x07D0, 5),
];

const UV_RANGES: &[(u16, u16)] = &[
    (0x0000, 2), // 0x0000 intensity (÷100), 0x0001 UV index
    (0x0009, 1),
    (0x0020, 1), // undocumented, static 0x3F80 — calibration coefficient?
    (0x0052, 1), // intensity deviation (÷100)
    (0x07D0, 5),
];

const LIGHT_RANGES: &[(u16, u16)] = &[
    (0x0002, 2), // illuminance hi/lo, (hi*65536+lo)/1000 Lux
    (0x0046, 3), // acquisition rate, calibration enable, calibration compensation
    (0x0064, 4), // address, baud code, parity, version
];

impl SensorModel {
    pub fn from_config_name(name: &str) -> Option<Self> {
        match name.trim().to_ascii_lowercase().as_str() {
            "irradiance" => Some(SensorModel::Irradiance),
            "par" => Some(SensorModel::Par),
            "uv" => Some(SensorModel::Uv),
            "light" => Some(SensorModel::Light),
            _ => None,
        }
    }

    pub fn config_name(&self) -> &'static str {
        match self {
            SensorModel::Irradiance => "irradiance",
            SensorModel::Par => "par",
            SensorModel::Uv => "uv",
            SensorModel::Light => "light",
        }
    }

    pub fn proto(&self) -> DfrobotSensorModel {
        match self {
            SensorModel::Irradiance => DfrobotSensorModel::DfrobotSen0640Irradiance,
            SensorModel::Par => DfrobotSensorModel::DfrobotSen0641Par,
            SensorModel::Uv => DfrobotSensorModel::DfrobotSen0642Uv,
            SensorModel::Light => DfrobotSensorModel::DfrobotSen0644Light,
        }
    }

    pub fn poll_ranges(&self) -> &'static [(u16, u16)] {
        match self {
            SensorModel::Irradiance => IRRADIANCE_RANGES,
            SensorModel::Par => PAR_RANGES,
            SensorModel::Uv => UV_RANGES,
            SensorModel::Light => LIGHT_RANGES,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL: [SensorModel; 4] = [
        SensorModel::Irradiance,
        SensorModel::Par,
        SensorModel::Uv,
        SensorModel::Light,
    ];

    #[test]
    fn config_names_round_trip() {
        for model in ALL {
            assert_eq!(
                SensorModel::from_config_name(model.config_name()),
                Some(model)
            );
        }
        assert_eq!(SensorModel::from_config_name("IRRADIANCE"), Some(SensorModel::Irradiance));
        assert_eq!(SensorModel::from_config_name("psr"), None);
        assert_eq!(SensorModel::from_config_name(""), None);
    }

    #[test]
    fn poll_ranges_are_sane() {
        for model in ALL {
            let ranges = model.poll_ranges();
            assert!(!ranges.is_empty(), "{model:?} has no ranges");
            for (start, count) in ranges {
                assert!(*count > 0, "{model:?} empty range at 0x{start:04X}");
                // fc 0x03 responses carry byte-count in one u8
                assert!(*count <= 125, "{model:?} range too long at 0x{start:04X}");
            }
            // No overlapping ranges within a model
            let mut spans: Vec<(u16, u16)> = ranges
                .iter()
                .map(|(start, count)| (*start, start + count - 1))
                .collect();
            spans.sort();
            for pair in spans.windows(2) {
                assert!(pair[0].1 < pair[1].0, "{model:?} ranges overlap");
            }
        }
    }

    #[test]
    fn measurement_registers_are_covered() {
        let covers = |model: SensorModel, register: u16| {
            model
                .poll_ranges()
                .iter()
                .any(|(start, count)| register >= *start && register < start + count)
        };
        assert!(covers(SensorModel::Irradiance, 0x0000));
        assert!(covers(SensorModel::Par, 0x0000));
        assert!(covers(SensorModel::Uv, 0x0000)); // intensity
        assert!(covers(SensorModel::Uv, 0x0001)); // UV index
        assert!(covers(SensorModel::Light, 0x0002)); // lux high word
        assert!(covers(SensorModel::Light, 0x0003)); // lux low word
    }

    #[test]
    fn proto_mapping_is_distinct() {
        let mut protos: Vec<i32> = ALL.iter().map(|m| m.proto() as i32).collect();
        protos.sort();
        protos.dedup();
        assert_eq!(protos.len(), ALL.len());
    }
}
