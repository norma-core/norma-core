//! Mini PCIe rail power for the Portenta Max Carrier.
//!
//! `EN_3V3_PCIE` is line 29 on the STM32 bridge, which sits in the
//! PWM-shadowed line block: the H7 firmware honours the PWM route and
//! ignores plain GPIO writes, so the rail is switched via pwm6 on the
//! x8h7 pwm chip (duty == period drives the line high). The line state
//! survives Linux reboots but clears on a cold power cycle, and nothing
//! else re-asserts it when no cellular daemon is active — so the driver
//! does it whenever the modem is missing from USB.

use std::path::{Path, PathBuf};

const RAIL_PWM_CHANNEL: &str = "6";
const RAIL_PWM_PERIOD_NS: &str = "1000000";

/// Finds the pwm chip bridged from the x8h7 (its sysfs device resolves to
/// a platform device containing "x8h7").
pub fn find_x8h7_pwmchip(pwm_class_dir: &Path) -> Option<PathBuf> {
    for entry in std::fs::read_dir(pwm_class_dir).ok()?.flatten() {
        let device = std::fs::canonicalize(entry.path().join("device"));
        if let Ok(device) = device {
            if device
                .file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.contains("x8h7"))
            {
                return Some(entry.path());
            }
        }
    }
    None
}

/// Drives the EN_3V3_PCIE rail high via pwm6 on the given chip. Idempotent;
/// exports the channel if needed. Returns an error string when sysfs writes
/// fail (caller logs and retries on the next scan).
pub fn assert_pcie_rail(pwmchip_dir: &Path) -> Result<(), String> {
    let channel_dir = pwmchip_dir.join(format!("pwm{RAIL_PWM_CHANNEL}"));
    if !channel_dir.is_dir() {
        write_sysfs(&pwmchip_dir.join("export"), RAIL_PWM_CHANNEL)?;
    }
    if !channel_dir.is_dir() {
        return Err(format!(
            "pwm channel {RAIL_PWM_CHANNEL} did not appear after export in {}",
            pwmchip_dir.display()
        ));
    }
    write_sysfs(&channel_dir.join("period"), RAIL_PWM_PERIOD_NS)?;
    write_sysfs(&channel_dir.join("duty_cycle"), RAIL_PWM_PERIOD_NS)?;
    write_sysfs(&channel_dir.join("enable"), "1")?;
    Ok(())
}

fn write_sysfs(path: &Path, value: &str) -> Result<(), String> {
    std::fs::write(path, value).map_err(|e| format!("write {} to {}: {e}", value, path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::symlink;

    struct FakePwmSysfs {
        root: PathBuf,
    }

    impl FakePwmSysfs {
        fn new(name: &str) -> Self {
            let root = std::env::temp_dir()
                .join(format!("arduino-pro-4g-gnss-pwm-{}-{name}", std::process::id()));
            let _ = fs::remove_dir_all(&root);
            fs::create_dir_all(root.join("class/pwm")).unwrap();
            FakePwmSysfs { root }
        }

        fn pwm_class_dir(&self) -> PathBuf {
            self.root.join("class/pwm")
        }

        fn add_chip(&self, name: &str, platform_device: &str) -> PathBuf {
            let device_dir = self.root.join(format!("devices/platform/{platform_device}"));
            fs::create_dir_all(&device_dir).unwrap();
            let chip_dir = self.pwm_class_dir().join(name);
            fs::create_dir_all(&chip_dir).unwrap();
            fs::write(chip_dir.join("export"), "").unwrap();
            symlink(&device_dir, chip_dir.join("device")).unwrap();
            chip_dir
        }
    }

    impl Drop for FakePwmSysfs {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn finds_chip_whose_device_is_the_x8h7_bridge() {
        let sysfs = FakePwmSysfs::new("find");
        sysfs.add_chip("pwmchip0", "3000000.pwm");
        let expected = sysfs.add_chip("pwmchip2", "x8h7pwm");

        assert_eq!(find_x8h7_pwmchip(&sysfs.pwm_class_dir()), Some(expected));
    }

    #[test]
    fn returns_none_without_an_x8h7_chip() {
        let sysfs = FakePwmSysfs::new("none");
        sysfs.add_chip("pwmchip0", "3000000.pwm");

        assert_eq!(find_x8h7_pwmchip(&sysfs.pwm_class_dir()), None);
    }

    #[test]
    fn asserts_rail_on_already_exported_channel() {
        let sysfs = FakePwmSysfs::new("assert");
        let chip = sysfs.add_chip("pwmchip0", "x8h7pwm");
        let pwm6 = chip.join("pwm6");
        fs::create_dir_all(&pwm6).unwrap();
        for f in ["period", "duty_cycle", "enable"] {
            fs::write(pwm6.join(f), "0\n").unwrap();
        }

        assert_pcie_rail(&chip).expect("rail assert should succeed");

        assert_eq!(fs::read_to_string(pwm6.join("period")).unwrap(), "1000000");
        assert_eq!(
            fs::read_to_string(pwm6.join("duty_cycle")).unwrap(),
            "1000000"
        );
        assert_eq!(fs::read_to_string(pwm6.join("enable")).unwrap(), "1");
    }

    #[test]
    fn exports_channel_when_missing() {
        let sysfs = FakePwmSysfs::new("export");
        let chip = sysfs.add_chip("pwmchip0", "x8h7pwm");

        // A real kernel would create pwm6/ in response to the export write;
        // the fake cannot, so the call must fail — but the export file must
        // show the attempt.
        assert!(assert_pcie_rail(&chip).is_err());
        assert_eq!(fs::read_to_string(chip.join("export")).unwrap(), "6");
    }
}
