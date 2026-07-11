pub const KNOWN_PRODUCT_IDS: &[(u16, &str)] = &[
    (0xA053, "SmartSolar MPPT 75|15"),
    (0xA075, "SmartSolar MPPT 75|15 rev2"),
];

pub fn model_name_for(product_id: u16) -> Option<&'static str> {
    KNOWN_PRODUCT_IDS
        .iter()
        .find(|(id, _)| *id == product_id)
        .map(|(_, name)| *name)
}

pub fn is_known_product_id(product_id: u16) -> bool {
    KNOWN_PRODUCT_IDS.iter().any(|(id, _)| *id == product_id)
}

pub const REG_DEVICE_MODE: u16 = 0x0200;
pub const REG_REMOTE_CONTROL_USED: u16 = 0x0202;
pub const REG_SOLAR_ACTIVITY: u16 = 0x2030;
pub const REG_LOAD_OFF_REASON: u16 = 0xED91;
pub const REG_LOAD_OUTPUT_VOLTAGE: u16 = 0xEDA9;
pub const REG_CHARGER_INTERNAL_TEMP: u16 = 0xEDDB;

/// Live registers polled once per second; only values the TEXT block lacks.
pub const CURRENT_GROUP: &[u16] = &[
    REG_DEVICE_MODE,
    REG_REMOTE_CONTROL_USED,
    REG_SOLAR_ACTIVITY,
    REG_LOAD_OFF_REASON,
    REG_LOAD_OUTPUT_VOLTAGE,
    REG_CHARGER_INTERNAL_TEMP,
];
