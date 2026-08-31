use crate::dfrobot_light_rs485_proto::DfrobotSensorModel;

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
    /// A device that answers the bus but does not match any known model's
    /// signatures. Polled with a generic register set so its data is captured
    /// and can be identified later from history.
    Unknown,
}

/// Per-cycle read, radiation family: the low window 0x0000..=0x0020
/// (measurements, derived channels, hardware id, uv constant 0x0020).
/// Verified safe as one 33-register block on SEN0640/0641/0642 (2026-07-30);
/// 125-register blocks zero out 0x0020 — NEVER enlarge this block.
const RADIATION_PER_CYCLE_RANGES: &[(u16, u16)] = &[(0x0000, 33)];

/// Per-cycle read, SEN0644 light family and unknown devices: 0x0000..=0x0009
/// (lux hi/lo at 0x0002/0x0003 plus the low spare registers).
/// SEN0644 answers block reads of AT MOST 13 registers (hardware-verified
/// 2026-07-30: x13 OK, x14+ malformed) — NEVER enlarge past 13. Unknown
/// devices use this plan too, since they may be light-family.
const LIGHT_PER_CYCLE_RANGES: &[(u16, u16)] = &[(0x0000, 10)];

/// Connection-static registers, radiation family (SEN0640/0641/0642).
/// Read once at connect and cached; the 0x0830 block and 0x00F0 answer
/// only small/single reads (deep-sweep finding 2026-07-29).
const RADIATION_STATIC_RANGES: &[(u16, u16)] = &[
    (0x0052, 1), // deviation setting
    (0x07D0, 5), // address, baud, 0x07D2, serial pair 0x07D3/0x07D4
    (0x0834, 1),
    (0x0837, 1),
    (0x0839, 1),
    (0x083B, 1), // full-scale range constant (1800/2500/1500)
    (0x0840, 1),
    (0x0841, 1),
    (0x0842, 1),
    (0x0844, 1),
    (0x0849, 1),
    (0x00F0, 1), // factory-reset magic 0xDAA5 (read-only here; never written)
];

/// Connection-static registers, SEN0644 light.
const LIGHT_STATIC_RANGES: &[(u16, u16)] = &[
    (0x0046, 3), // acquisition rate, calibration enable, calibration compensation
    (0x0064, 4), // address, baud code, parity, version
];

/// Unknown devices capture both families' static sets.
const UNKNOWN_STATIC_RANGES: &[(u16, u16)] = &[
    (0x0046, 3),
    (0x0064, 4),
    (0x0052, 1),
    (0x07D0, 5),
    (0x0834, 1),
    (0x0837, 1),
    (0x0839, 1),
    (0x083B, 1),
    (0x0840, 1),
    (0x0841, 1),
    (0x0842, 1),
    (0x0844, 1),
    (0x0849, 1),
    (0x00F0, 1),
];

impl SensorModel {
    pub fn from_config_name(name: &str) -> Option<Self> {
        match name.trim().to_ascii_lowercase().as_str() {
            "irradiance" => Some(SensorModel::Irradiance),
            "par" => Some(SensorModel::Par),
            "uv" => Some(SensorModel::Uv),
            "light" => Some(SensorModel::Light),
            "unknown" => Some(SensorModel::Unknown),
            _ => None,
        }
    }

    pub fn config_name(&self) -> &'static str {
        match self {
            SensorModel::Irradiance => "irradiance",
            SensorModel::Par => "par",
            SensorModel::Uv => "uv",
            SensorModel::Light => "light",
            SensorModel::Unknown => "unknown",
        }
    }

    pub fn proto(&self) -> DfrobotSensorModel {
        match self {
            SensorModel::Irradiance => DfrobotSensorModel::DfrobotSen0640Irradiance,
            SensorModel::Par => DfrobotSensorModel::DfrobotSen0641Par,
            SensorModel::Uv => DfrobotSensorModel::DfrobotSen0642Uv,
            SensorModel::Light => DfrobotSensorModel::DfrobotSen0644Light,
            SensorModel::Unknown => DfrobotSensorModel::DfrobotModelUnspecified,
        }
    }

    pub fn poll_ranges(&self) -> &'static [(u16, u16)] {
        match self {
            SensorModel::Irradiance | SensorModel::Par | SensorModel::Uv => {
                RADIATION_PER_CYCLE_RANGES
            }
            SensorModel::Light | SensorModel::Unknown => LIGHT_PER_CYCLE_RANGES,
        }
    }

    pub fn static_ranges(&self) -> &'static [(u16, u16)] {
        match self {
            SensorModel::Irradiance | SensorModel::Par | SensorModel::Uv => {
                RADIATION_STATIC_RANGES
            }
            SensorModel::Light => LIGHT_STATIC_RANGES,
            SensorModel::Unknown => UNKNOWN_STATIC_RANGES,
        }
    }
}

/// Detection registers (single-register reads only — see RADIATION_STATIC_RANGES note).
pub const REG_RADIATION_ADDRESS: u16 = 0x07D0;
pub const REG_LIGHT_ADDRESS: u16 = 0x0064;
pub const REG_RANGE_CONSTANT: u16 = 0x083B;
pub const REG_HARDWARE_ID: u16 = 0x0009;
pub const REG_LIGHT_VERSION: u16 = 0x0067;

/// Classifies a responding device from its detection-register reads.
///
/// `radiation_addr` / `light_addr` are single reads of 0x07D0 / 0x0064: the
/// register that echoes the device's own Modbus id identifies its config
/// family (the other family's register reads 0 on real hardware, and ids
/// start at 1, so there is no ambiguity; radiation is checked first).
/// `range` / `hw_id` are reads of 0x083B / 0x0009, meaningful only for the
/// radiation family; callers pass 0 when unread.
pub fn classify(
    modbus_id: u8,
    radiation_addr: u16,
    light_addr: u16,
    range: u16,
    hw_id: u16,
) -> SensorModel {
    let id = modbus_id as u16;
    if radiation_addr == id {
        return match (range, hw_id) {
            (1800, 0x0104) => SensorModel::Irradiance,
            (2500, 0x0102) => SensorModel::Par,
            (1500, 0x0202) => SensorModel::Uv,
            _ => SensorModel::Unknown,
        };
    }
    if light_addr == id {
        return SensorModel::Light;
    }
    SensorModel::Unknown
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL: [SensorModel; 5] = [
        SensorModel::Irradiance,
        SensorModel::Par,
        SensorModel::Uv,
        SensorModel::Light,
        SensorModel::Unknown,
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
    fn per_cycle_plans_respect_block_limits() {
        assert_eq!(SensorModel::Irradiance.poll_ranges(), &[(0x0000, 33)]);
        assert_eq!(SensorModel::Par.poll_ranges(), &[(0x0000, 33)]);
        assert_eq!(SensorModel::Uv.poll_ranges(), &[(0x0000, 33)]);
        assert_eq!(SensorModel::Light.poll_ranges(), &[(0x0000, 10)]);
        assert_eq!(SensorModel::Unknown.poll_ranges(), &[(0x0000, 10)]);

        for model in ALL {
            let total: u16 = model.poll_ranges().iter().map(|(_, count)| *count).sum();
            assert!(total <= 33, "{model:?} per-cycle read exceeds 33 registers");
            if matches!(model, SensorModel::Light | SensorModel::Unknown) {
                assert!(
                    total <= 13,
                    "{model:?} per-cycle read exceeds the SEN0644 13-register block limit"
                );
            }
        }
    }

    #[test]
    fn static_ranges_are_sane() {
        for model in ALL {
            let ranges = model.static_ranges();
            assert!(!ranges.is_empty(), "{model:?} has no static ranges");
            for (start, count) in ranges {
                assert!(*count > 0, "{model:?} empty static range at 0x{start:04X}");
                assert!(*count <= 125, "{model:?} static range too long");
                // statics must not overlap the per-cycle block (0x0000..=0x0020)
                assert!(*start > 0x0020, "{model:?} static 0x{start:04X} overlaps low block");
            }
            let mut spans: Vec<(u16, u16)> = ranges
                .iter()
                .map(|(start, count)| (*start, start + count - 1))
                .collect();
            spans.sort();
            for pair in spans.windows(2) {
                assert!(pair[0].1 < pair[1].0, "{model:?} static ranges overlap");
            }
        }
    }

    #[test]
    fn radiation_family_shares_one_static_set() {
        assert_eq!(
            SensorModel::Irradiance.static_ranges(),
            SensorModel::Par.static_ranges()
        );
        assert_eq!(
            SensorModel::Par.static_ranges(),
            SensorModel::Uv.static_ranges()
        );
        assert_ne!(
            SensorModel::Light.static_ranges(),
            SensorModel::Irradiance.static_ranges()
        );
    }

    #[test]
    fn static_ranges_cover_spec_registers() {
        let covers = |ranges: &[(u16, u16)], register: u16| {
            ranges
                .iter()
                .any(|(start, count)| register >= *start && register < start + count)
        };
        let radiation = SensorModel::Uv.static_ranges();
        for register in [0x0052, 0x07D0, 0x07D4, 0x0834, 0x083B, 0x0849, 0x00F0] {
            assert!(covers(radiation, register), "radiation missing 0x{register:04X}");
        }
        let light = SensorModel::Light.static_ranges();
        for register in [0x0046, 0x0048, 0x0064, 0x0067] {
            assert!(covers(light, register), "light missing 0x{register:04X}");
        }
        let unknown = SensorModel::Unknown.static_ranges();
        for register in [0x0046, 0x0067, 0x0052, 0x07D0, 0x083B, 0x00F0] {
            assert!(covers(unknown, register), "unknown missing 0x{register:04X}");
        }
    }

    #[test]
    fn proto_mapping_is_distinct() {
        let mut protos: Vec<i32> = ALL.iter().map(|m| m.proto() as i32).collect();
        protos.sort();
        protos.dedup();
        assert_eq!(protos.len(), ALL.len());
    }

    #[test]
    fn classify_radiation_models_from_sweep_values() {
        // Hardware-verified triples from deep-sweep-2026-07-29
        assert_eq!(classify(1, 1, 0, 1800, 0x0104), SensorModel::Irradiance);
        assert_eq!(classify(2, 2, 0, 2500, 0x0102), SensorModel::Par);
        assert_eq!(classify(3, 3, 0, 1500, 0x0202), SensorModel::Uv);
    }

    #[test]
    fn classify_light_family() {
        // SEN0644 echoes its id at 0x0064, reads 0 at 0x07D0
        assert_eq!(classify(4, 0, 4, 0, 0), SensorModel::Light);
    }

    #[test]
    fn classify_unknown_range_value() {
        // radiation family but unrecognized full-scale range
        assert_eq!(classify(5, 5, 0, 3000, 0x0104), SensorModel::Unknown);
    }

    #[test]
    fn classify_hw_id_contradiction() {
        // range says par, hw id says uv -> refuse to guess
        assert_eq!(classify(2, 2, 0, 2500, 0x0202), SensorModel::Unknown);
    }

    #[test]
    fn classify_neither_family() {
        // answers the bus but neither config register echoes the id
        assert_eq!(classify(6, 0, 0, 0, 0), SensorModel::Unknown);
        assert_eq!(classify(6, 3, 9, 0, 0), SensorModel::Unknown);
    }

    #[test]
    fn classify_radiation_takes_precedence() {
        // pathological double echo: radiation branch wins (documented order)
        assert_eq!(classify(7, 7, 7, 1800, 0x0104), SensorModel::Irradiance);
    }

    #[test]
    fn unknown_model_identity() {
        assert_eq!(SensorModel::Unknown.config_name(), "unknown");
        assert_eq!(
            SensorModel::from_config_name("unknown"),
            Some(SensorModel::Unknown)
        );
        assert_eq!(
            SensorModel::Unknown.proto(),
            DfrobotSensorModel::DfrobotModelUnspecified
        );
        assert!(!SensorModel::Unknown.poll_ranges().is_empty());
    }
}
