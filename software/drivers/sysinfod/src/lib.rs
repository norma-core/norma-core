use bytes::Bytes;
use normfs::NormFS;
use prost::Message;
use station_iface::StationEngine;
use station_iface::iface_proto::drivers::QueueDataType;
#[cfg(target_os = "linux")]
use std::fs;
#[cfg(target_os = "macos")]
use std::process::Command;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use sysinfo::{Components, Disks, Networks, System, Users};
use tokio::sync::RwLock;
use tokio::time;

const QUEUE_ID: &str = "system/rx";
const CELLULAR_REFRESH_INTERVAL_SECS: u64 = 5;
const CELLULAR_REFRESH_INTERVAL_NS: u64 = CELLULAR_REFRESH_INTERVAL_SECS * 1_000_000_000;

pub mod sysinfo_proto {
    pub mod sysinfo {
        include!("proto/sysinfo.rs");
    }
}

mod cellular;
mod power;

use crate::sysinfo_proto::sysinfo::{
    CellularModem, Cpu, Disk, Envelope, EnvelopeData, Memory, Motherboard, Network, NetworkIp,
    OsInfo, PowerSource, TemperatureSensor, TimeInfo, User,
};

pub struct SystemMonitor {
    normfs: Arc<NormFS>,
    queue_id: normfs::QueueId,
    system: Arc<RwLock<System>>,
    disks: Arc<RwLock<Disks>>,
    networks: Arc<RwLock<Networks>>,
    components: Arc<RwLock<Components>>,
    users: Arc<RwLock<Users>>,
    static_data: Arc<StaticSystemData>,
    cellular_cache: Arc<RwLock<CellularCache>>,
}

#[derive(Default)]
struct CellularCache {
    next_refresh_monotonic_stamp_ns: u64,
    modems: Vec<CellularModem>,
}

struct StaticSystemData {
    unique_device_id: String,
    os_info: OsInfo,
    motherboard: Motherboard,
    cpu_info: Vec<CpuInfo>,
}

struct CpuInfo {
    name: String,
    vendor_id: String,
    brand: String,
    frequency: u64,
}

impl SystemMonitor {
    pub async fn new<T: StationEngine>(
        normfs: Arc<NormFS>,
        station_engine: Arc<T>,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let mut system = System::new_all();
        system.refresh_all();

        let disks = Disks::new_with_refreshed_list();
        let networks = Networks::new_with_refreshed_list();
        let components = Components::new_with_refreshed_list();
        let users = Users::new_with_refreshed_list();

        let static_data = Arc::new(StaticSystemData::collect(&system));

        let queue_id = normfs.resolve(QUEUE_ID);
        normfs.ensure_queue_exists_for_write(&queue_id).await?;
        station_engine.register_queue(&queue_id, QueueDataType::QdtSystem, vec![]);

        Ok(Self {
            normfs,
            queue_id,
            system: Arc::new(RwLock::new(system)),
            disks: Arc::new(RwLock::new(disks)),
            networks: Arc::new(RwLock::new(networks)),
            components: Arc::new(RwLock::new(components)),
            users: Arc::new(RwLock::new(users)),
            static_data,
            cellular_cache: Arc::new(RwLock::new(CellularCache::default())),
        })
    }

    pub fn start(self: Arc<Self>) {
        tokio::spawn(async move {
            let mut interval = time::interval(Duration::from_secs(1));

            loop {
                if let Err(e) = self.update_and_send().await {
                    eprintln!("Failed to update system monitor: {}", e);
                }

                interval.tick().await;
            }
        });
    }

    async fn update_and_send(&self) -> Result<(), Box<dyn std::error::Error>> {
        let envelope = self.collect_system_data().await?;

        let mut buf = Vec::new();
        envelope.encode(&mut buf)?;

        self.normfs.enqueue(&self.queue_id, Bytes::from(buf))?;

        Ok(())
    }

    async fn collect_system_data(&self) -> Result<Envelope, Box<dyn std::error::Error>> {
        let cellular_modems = self.collect_cellular_modems().await;
        let mut system = self.system.write().await;
        let mut disks = self.disks.write().await;
        let mut networks = self.networks.write().await;
        let mut components = self.components.write().await;
        let mut users = self.users.write().await;

        system.refresh_all();
        disks.refresh(true);
        networks.refresh(true);
        components.refresh(true);
        users.refresh();

        let data = EnvelopeData {
            os: Some(self.static_data.os_info.clone()),
            time: Some(self.collect_time_info()),
            memory: Some(self.collect_memory(&system)),
            motherboard: Some(self.static_data.motherboard.clone()),
            hostname: System::host_name().unwrap_or_default(),
            unique_id: self.static_data.unique_device_id.clone(),
            cpu_arch: System::cpu_arch(),
            physical_core_count: System::physical_core_count().unwrap_or(0) as u64,
            name: System::name().unwrap_or_default(),
            users: self.collect_all_users_info(&users),
            cpu: self.collect_cpu_data(&system),
            disks: self.collect_disk_data(&disks),
            networks: self.collect_network_data(&networks),
            temperatures: self.collect_temperature_data(&components),
            power_sources: self.collect_power_sources(),
            cellular_modems,
        };

        Ok(Envelope {
            monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
            local_stamp_ns: systime::get_local_stamp_ns(),
            app_start_id: systime::get_app_start_id(),
            data: Some(data),
        })
    }

    fn collect_time_info(&self) -> TimeInfo {
        TimeInfo {
            utc_offset_seconds: Self::get_timezone_offset_seconds() as i64,
        }
    }

    fn collect_memory(&self, system: &System) -> Memory {
        Memory {
            total_bytes: system.total_memory(),
            used_bytes: system.used_memory(),
            total_swap_bytes: system.total_swap(),
            used_swap_bytes: system.used_swap(),
        }
    }

    fn collect_all_users_info(&self, users: &Users) -> Vec<User> {
        users
            .list()
            .iter()
            .map(|user| User {
                name: user.name().to_string(),
                groups: user.groups().iter().map(|g| g.name().to_string()).collect(),
            })
            .collect()
    }

    fn collect_cpu_data(&self, system: &System) -> Vec<Cpu> {
        system
            .cpus()
            .iter()
            .enumerate()
            .map(|(idx, cpu)| {
                let static_info = self
                    .static_data
                    .cpu_info
                    .get(idx)
                    .unwrap_or(&self.static_data.cpu_info[0]);

                Cpu {
                    name: static_info.name.clone(),
                    vendor_id: static_info.vendor_id.clone(),
                    brand: static_info.brand.clone(),
                    frequency: static_info.frequency,
                    usage: cpu.cpu_usage(),
                }
            })
            .collect()
    }

    fn collect_disk_data(&self, disks: &Disks) -> Vec<Disk> {
        disks
            .iter()
            .map(|disk| Disk {
                kind: format!("{:?}", disk.kind()),
                fs: disk.file_system().to_string_lossy().to_string(),
                name: disk.name().to_string_lossy().to_string(),
                mount_point: disk.mount_point().to_string_lossy().to_string(),
                removable: disk.is_removable(),
                read_only: disk.is_read_only(),
                total_space_bytes: disk.total_space(),
                available_space_bytes: disk.available_space(),
                total_read_bytes: 0,
                total_written_bytes: 0,
            })
            .collect()
    }

    fn collect_network_data(&self, networks: &Networks) -> Vec<Network> {
        networks
            .iter()
            .map(|(iface, data)| {
                // Collect IP addresses
                let ips = data
                    .ip_networks()
                    .iter()
                    .map(|ip_network| NetworkIp {
                        addr: ip_network.addr.to_string(),
                    })
                    .collect();

                Network {
                    iface: iface.clone(),
                    mac_address: data.mac_address().to_string(),
                    ips,
                    bytes_received: data.total_received(),
                    bytes_transmitted: data.total_transmitted(),
                    packets_received: data.total_packets_received(),
                    packets_transmitted: data.total_packets_transmitted(),
                    errors_received: data.total_errors_on_received(),
                    errors_transmitted: data.total_errors_on_transmitted(),
                }
            })
            .collect()
    }

    fn collect_temperature_data(&self, components: &Components) -> Vec<TemperatureSensor> {
        components
            .iter()
            .enumerate()
            .map(|(idx, component)| TemperatureSensor {
                id: format!("temp_{}", idx),
                name: component.label().to_string(),
                value: component.temperature().unwrap_or(0.0),
                max: component.max().unwrap_or(0.0),
                critical: component.critical().unwrap_or(0.0),
            })
            .collect()
    }

    fn collect_power_sources(&self) -> Vec<PowerSource> {
        power::collect_power_sources()
    }

    async fn collect_cellular_modems(&self) -> Vec<CellularModem> {
        let mut cache = self.cellular_cache.write().await;
        let now_ns = systime::get_monotonic_stamp_ns();
        if now_ns < cache.next_refresh_monotonic_stamp_ns {
            return cache.modems.clone();
        }

        let modems = tokio::task::spawn_blocking(cellular::collect_cellular_modems)
            .await
            .unwrap_or_default();

        cache.next_refresh_monotonic_stamp_ns =
            systime::get_monotonic_stamp_ns().saturating_add(CELLULAR_REFRESH_INTERVAL_NS);
        cache.modems = modems;
        cache.modems.clone()
    }

    fn get_timezone_offset_seconds() -> i32 {
        #[cfg(unix)]
        {
            use libc::{localtime_r, tm};
            use std::mem::MaybeUninit;

            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs() as i64;

            unsafe {
                let mut local_tm = MaybeUninit::<tm>::uninit();
                localtime_r(&now, local_tm.as_mut_ptr());
                let local_tm = local_tm.assume_init();

                // tm_gmtoff is the offset from UTC in seconds
                local_tm.tm_gmtoff as i32
            }
        }

        #[cfg(not(unix))]
        {
            // Default to 0 (UTC) on non-Unix systems
            0
        }
    }
}

impl StaticSystemData {
    fn collect(system: &System) -> Self {
        let os_info = OsInfo {
            name: System::name().unwrap_or_default(),
            release: System::os_version().unwrap_or_default(),
            kernel_version: System::kernel_version().unwrap_or_default(),
        };

        let motherboard = Motherboard {
            name: String::new(),
            vendor_name: String::new(),
            version: String::new(),
            serial_number: String::new(),
            asset_tag: String::new(),
        };

        let cpu_info: Vec<CpuInfo> = system
            .cpus()
            .iter()
            .map(|cpu| CpuInfo {
                name: cpu.name().to_string(),
                vendor_id: cpu.vendor_id().to_string(),
                brand: cpu.brand().to_string(),
                frequency: cpu.frequency(),
            })
            .collect();

        Self {
            os_info,
            motherboard,
            cpu_info,
            unique_device_id: fetch_hardware_id().unwrap_or_default(),
        }
    }
}

pub fn fetch_hardware_id() -> Option<String> {
    #[cfg(target_os = "linux")]
    return fetch_linux_hardware_id();

    #[cfg(target_os = "macos")]
    return fetch_macos_hardware_id();

    #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
    None
}

#[cfg(target_os = "linux")]
fn fetch_linux_hardware_id() -> Option<String> {
    const LINUX_ID_PATHS: &[&str] = &[
        "/sys/class/dmi/id/product_uuid",
        "/etc/machine-id",
        "/var/lib/dbus/machine-id",
    ];

    for path in LINUX_ID_PATHS {
        if let Some(id) = read_and_validate_file(path) {
            return Some(id);
        }
    }

    extract_cpu_serial()
}

#[cfg(target_os = "macos")]
fn fetch_macos_hardware_id() -> Option<String> {
    if let Some(id) = get_macos_hardware_uuid() {
        return Some(id);
    }

    get_macos_platform_uuid()
}

#[cfg(target_os = "linux")]
fn read_and_validate_file(path: &str) -> Option<String> {
    fs::read_to_string(path)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && !is_null_uuid(s))
}

#[cfg(target_os = "linux")]
fn is_null_uuid(uuid: &str) -> bool {
    uuid == "00000000-0000-0000-0000-000000000000"
}

#[cfg(target_os = "linux")]
fn extract_cpu_serial() -> Option<String> {
    fs::read_to_string("/proc/cpuinfo")
        .ok()
        .and_then(|content| {
            content
                .lines()
                .find(|line| line.starts_with("Serial"))
                .and_then(|line| line.split(':').nth(1))
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty() && s != "0000000000000000")
        })
}

#[cfg(target_os = "macos")]
fn get_macos_hardware_uuid() -> Option<String> {
    Command::new("system_profiler")
        .args(["SPHardwareDataType"])
        .output()
        .ok()
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .and_then(|stdout| {
            stdout
                .lines()
                .find(|line| line.contains("Hardware UUID:"))
                .and_then(|line| line.split(':').nth(1))
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        })
}

#[cfg(target_os = "macos")]
fn get_macos_platform_uuid() -> Option<String> {
    Command::new("ioreg")
        .args(["-rd1", "-c", "IOPlatformExpertDevice"])
        .output()
        .ok()
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .and_then(|stdout| {
            stdout
                .lines()
                .find(|line| line.contains("IOPlatformUUID"))
                .and_then(|line| {
                    let start = line.find('"')?;
                    let end = line.rfind('"')?;
                    if start < end {
                        Some(line[start + 1..end].to_string())
                    } else {
                        None
                    }
                })
                .filter(|s| !s.is_empty())
        })
}

pub async fn start_system_monitor<T: StationEngine>(
    normfs: Arc<NormFS>,
    station_engine: Arc<T>,
) -> Result<Arc<SystemMonitor>, Box<dyn std::error::Error>> {
    let monitor = Arc::new(SystemMonitor::new(normfs, station_engine).await?);
    monitor.clone().start();
    Ok(monitor)
}
