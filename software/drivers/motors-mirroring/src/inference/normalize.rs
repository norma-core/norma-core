#![allow(clippy::collapsible_else_if)]

use crate::config::MotorConfig;

pub fn get_steps_range(min: u16, max: u16, config: &MotorConfig) -> u16 {
    if max >= min {
        max - min
    } else {
        (config.max_steps - min) + max
    }
}

pub fn normalize_position(
    source_position: u16,
    range_min: u16,
    range_max: u16,
    config: &MotorConfig,
) -> f64 {
    let range_size = get_steps_range(range_min, range_max, config);
    if range_size == 0 {
        return 50.0;
    }

    let relative_pos = if range_max >= range_min {
        if source_position >= range_min && source_position <= range_max {
            source_position - range_min
        } else if source_position < range_min {
            0
        } else {
            range_size
        }
    } else {
        if source_position >= range_min {
            source_position - range_min
        } else if source_position <= range_max {
            (config.max_steps - range_min) + source_position
        } else {
            let dist_to_min = range_min - source_position;
            let dist_to_max = source_position - range_max;
            if dist_to_min < dist_to_max {
                0
            } else {
                range_size
            }
        }
    };

    let percentage = (relative_pos as f64 / range_size as f64) * 100.0;

    percentage.clamp(0.0, 100.0)
}
