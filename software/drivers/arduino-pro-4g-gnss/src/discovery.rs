//! Modem serial-port discovery via sysfs.
//!
//! All four EG25-G ports share USB VID/PID 2c7c:0125 and tty names shift
//! whenever other adapters are present, so ports are told apart by USB
//! interface number: 0 = diagnostics, 1 = NMEA, 2 = primary AT (held by
//! ModemManager), 3 = secondary AT.

use std::path::{Path, PathBuf};

use crate::driver::{USB_PID, USB_VID};

const NMEA_INTERFACE: u32 = 1;
/// Secondary AT interface first: the primary one is ModemManager's.
const AT_INTERFACES_PREFERRED: [u32; 2] = [3, 2];

#[derive(Debug, Default, PartialEq, Eq)]
pub struct ModemPorts {
    pub nmea: Option<PathBuf>,
    /// AT ports usable for GNSS setup, most preferred first.
    pub at_candidates: Vec<PathBuf>,
}

/// Scans a sysfs tty class directory (`/sys/class/tty` in production) for
/// the modem's ports and returns their `/dev` paths.
pub fn discover_modem_ports(tty_class_dir: &Path, dev_dir: &Path) -> ModemPorts {
    let mut ports = ModemPorts::default();
    let mut at_ports: Vec<(u32, PathBuf)> = Vec::new();

    let Ok(entries) = std::fs::read_dir(tty_class_dir) else {
        return ports;
    };

    for entry in entries.flatten() {
        let device = entry.path().join("device");
        let Some(interface) = read_sysfs_u32(&device.join("../bInterfaceNumber")) else {
            continue;
        };
        let vid = read_sysfs_u32(&device.join("../../idVendor"));
        let pid = read_sysfs_u32(&device.join("../../idProduct"));
        if vid != Some(USB_VID as u32) || pid != Some(USB_PID as u32) {
            continue;
        }

        let dev_path = dev_dir.join(entry.file_name());
        if interface == NMEA_INTERFACE {
            ports.nmea = Some(dev_path);
        } else if AT_INTERFACES_PREFERRED.contains(&interface) {
            at_ports.push((interface, dev_path));
        }
    }

    for wanted in AT_INTERFACES_PREFERRED {
        for (interface, path) in &at_ports {
            if *interface == wanted {
                ports.at_candidates.push(path.clone());
            }
        }
    }

    ports
}

/// Reads a sysfs attribute holding a hex number (idVendor, idProduct,
/// bInterfaceNumber are all zero-padded hex).
fn read_sysfs_u32(path: &Path) -> Option<u32> {
    let raw = std::fs::read_to_string(path).ok()?;
    u32::from_str_radix(raw.trim(), 16).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::symlink;

    /// Builds a fake sysfs: usb device dirs with idVendor/idProduct,
    /// interface subdirs with bInterfaceNumber, and class/tty entries whose
    /// `device` symlink points into the interface dir, like real sysfs.
    struct FakeSysfs {
        root: PathBuf,
    }

    impl FakeSysfs {
        fn new(name: &str) -> Self {
            let root = std::env::temp_dir()
                .join(format!("arduino-pro-4g-gnss-{}-{name}", std::process::id()));
            let _ = fs::remove_dir_all(&root);
            fs::create_dir_all(root.join("class/tty")).unwrap();
            FakeSysfs { root }
        }

        fn tty_class_dir(&self) -> PathBuf {
            self.root.join("class/tty")
        }

        fn add_port(&self, tty: &str, vid: &str, pid: &str, interface: &str) {
            let usb_dev = self.root.join(format!("usb/{vid}:{pid}"));
            fs::create_dir_all(&usb_dev).unwrap();
            fs::write(usb_dev.join("idVendor"), format!("{vid}\n")).unwrap();
            fs::write(usb_dev.join("idProduct"), format!("{pid}\n")).unwrap();

            let iface_dir = usb_dev.join(format!("if{interface}"));
            let serial_dir = iface_dir.join(tty);
            fs::create_dir_all(&serial_dir).unwrap();
            fs::write(iface_dir.join("bInterfaceNumber"), format!("{interface}\n")).unwrap();

            let class_entry = self.tty_class_dir().join(tty);
            fs::create_dir_all(&class_entry).unwrap();
            symlink(&serial_dir, class_entry.join("device")).unwrap();
        }
    }

    impl Drop for FakeSysfs {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn finds_nmea_and_at_ports_by_interface_number() {
        let sysfs = FakeSysfs::new("full-modem");
        sysfs.add_port("ttyUSB1", "2c7c", "0125", "00");
        sysfs.add_port("ttyUSB2", "2c7c", "0125", "01");
        sysfs.add_port("ttyUSB3", "2c7c", "0125", "02");
        sysfs.add_port("ttyUSB4", "2c7c", "0125", "03");

        let ports = discover_modem_ports(&sysfs.tty_class_dir(), Path::new("/dev"));

        assert_eq!(ports.nmea, Some(PathBuf::from("/dev/ttyUSB2")));
        assert_eq!(
            ports.at_candidates,
            vec![PathBuf::from("/dev/ttyUSB4"), PathBuf::from("/dev/ttyUSB3")]
        );
    }

    #[test]
    fn ignores_other_usb_serial_devices() {
        let sysfs = FakeSysfs::new("ftdi-only");
        sysfs.add_port("ttyUSB0", "0403", "6001", "00");

        let ports = discover_modem_ports(&sysfs.tty_class_dir(), Path::new("/dev"));

        assert_eq!(ports, ModemPorts::default());
    }

    #[test]
    fn tolerates_class_entries_without_usb_metadata() {
        let sysfs = FakeSysfs::new("bare-tty");
        // A tty with no device symlink at all (e.g. a virtual console).
        fs::create_dir_all(sysfs.tty_class_dir().join("tty0")).unwrap();
        sysfs.add_port("ttyUSB2", "2c7c", "0125", "01");

        let ports = discover_modem_ports(&sysfs.tty_class_dir(), Path::new("/dev"));

        assert_eq!(ports.nmea, Some(PathBuf::from("/dev/ttyUSB2")));
    }
}
