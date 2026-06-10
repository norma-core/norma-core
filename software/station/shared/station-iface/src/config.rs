use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Config {
    pub drivers: Drivers,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub inference: Option<Vec<Inference>>,

    #[serde(rename = "cloud-offload", skip_serializing_if = "Option::is_none")]
    pub cloud_offload: Option<CloudOffloadConfig>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            drivers: Drivers::default(),
            inference: Some(vec![Inference::default_normvla()]),
            cloud_offload: None,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CloudOffloadConfig {
    /// Cloud storage bucket name
    pub bucket: String,

    /// Region (e.g., "us-east-1")
    pub region: String,

    /// Access key ID
    pub access_key_id: String,

    /// Secret access key
    pub secret_access_key: String,

    /// Optional endpoint URL for S3-compatible services (e.g., MinIO)
    pub endpoint: Option<String>,
}


#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Drivers {
    /// ST3215 servo bus configuration
    #[serde(skip_serializing_if = "Option::is_none")]
    pub st3215: Option<St3215Config>,

    /// Enable or disable system info monitoring
    #[serde(rename = "system-info")]
    pub system_info: bool,

    #[serde(rename = "usb-video", skip_serializing_if = "Option::is_none")]
    pub usb_video: Option<UsbVideoConfig>,

    #[serde(rename = "yahboom-dogzilla-lite", skip_serializing_if = "Option::is_none")]
    pub yahboom_dogzilla_lite: Option<YahboomDogzillaLiteConfig>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ov5647: Option<Ov5647Config>,
}

/// ST3215 servo bus configuration
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct St3215Config {
    /// Enable or disable the ST3215 driver
    #[serde(default = "default_st3215_enabled")]
    pub enabled: bool,

    /// Default current threshold for mirroring. When target motor's current exceeds this,
    /// set goal to current position to prevent overload. 0 means disabled. Default is 100.
    #[serde(rename = "current-threshold", default = "default_current_threshold")]
    pub current_threshold: u16,

    /// Per-motor current threshold overrides. Key is motor ID (0-255).
    /// Optional - if not specified, all motors use the default current-threshold.
    /// Example in YAML:
    /// ```yaml
    /// motor-current-thresholds:
    ///   8: 40   # Motor 8 has stricter limit
    ///   5: 60   # Motor 5 has more relaxed limit
    /// ```
    #[serde(rename = "motor-current-thresholds", default, skip_serializing_if = "Option::is_none")]
    pub motor_current_thresholds: Option<std::collections::HashMap<u8, u16>>,

    /// Deadband for mirroring. Minimum distance between current position
    /// and goal to trigger movement. Default is 20.
    #[serde(default = "default_deadband")]
    pub deadband: u16,
}

fn default_st3215_enabled() -> bool {
    true
}

fn default_current_threshold() -> u16 {
    100
}

fn default_deadband() -> u16 {
    20
}

impl Default for St3215Config {
    fn default() -> Self {
        Self {
            enabled: true,
            current_threshold: 100,
            motor_current_thresholds: None,
            deadband: 20,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Inference {
    /// Queue ID for inference data (e.g., "inference/normvla")
    #[serde(rename = "queue-id")]
    pub queue_id: String,

    /// Shared memory path (e.g., "/var/run/normvla")
    pub shm: PathBuf,

    /// Shared memory size in megabytes (e.g., 12 for 12MB)
    #[serde(rename = "shm-size-mb")]
    pub shm_size_mb: u64,

    /// Output format (e.g., "normvla")
    pub format: String,

    /// ST3215 bus identifier (e.g., "5AB9068587" or "auto")
    /// Default: "auto" (automatically selects the single bus with torque enabled)
    #[serde(rename = "st3215-bus", default = "default_st3215_bus")]
    pub st3215_bus: String,

    /// Update interval for publishing (e.g., "100ms")
    #[serde(rename = "update-interval", with = "humantime_serde", default = "default_update_interval")]
    pub update_interval: std::time::Duration,
}

fn default_update_interval() -> std::time::Duration {
    std::time::Duration::from_millis(100)
}

fn default_st3215_bus() -> String {
    "auto".to_string()
}

impl Inference {
    /// Create a default normvla inference configuration
    pub fn default_normvla() -> Self {
        // Use OS-appropriate path: /dev/shm for Linux (tmpfs, world-writable), /tmp for macOS
        let shm_path = if cfg!(target_os = "linux") {
            PathBuf::from("/dev/shm/normvla")
        } else {
            PathBuf::from("/tmp/normvla")
        };

        Self {
            queue_id: "inference/normvla".to_string(),
            shm: shm_path,
            shm_size_mb: 12,
            format: "normvla".to_string(),
            st3215_bus: "auto".to_string(),
            update_interval: default_update_interval(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UsbVideoConfig {
    pub enabled: bool,
    /// Target size for resizing frames (shortest dimension). Default: 224
    /// Set to 0 to disable resizing.
    #[serde(default = "default_resize_target")]
    pub resize_target: u32,
}

fn default_resize_target() -> u32 {
    224
}

impl Default for UsbVideoConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            resize_target: 224,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HikvisionConfig {
    /// List of RTSP URLs for Hikvision cameras
    pub rtsp: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum YahboomDogzillaLiteMode {
    Real,
    Simulation,
}

fn default_yahboom_dogzilla_lite_mode() -> YahboomDogzillaLiteMode {
    YahboomDogzillaLiteMode::Real
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct YahboomDogzillaLiteConfig {
    #[serde(default)]
    pub enabled: bool,

    #[serde(default = "default_yahboom_dogzilla_lite_mode")]
    pub mode: YahboomDogzillaLiteMode,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Ov5647Config {
    #[serde(default)]
    pub enabled: bool,

    #[serde(default = "default_ov5647_dimension", rename = "dimension")]
    pub dimension: String,

    #[serde(default = "default_ov5647_fps", rename = "frames-per-second")]
    pub frames_per_second: u16,
}

fn default_ov5647_dimension() -> String {
    "320x240".to_string()
}

fn default_ov5647_fps() -> u16 {
    30
}

pub fn parse_ov5647_dimension(value: &str) -> Option<(u32, u32)> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    let (width, height) = trimmed.split_once('x')?;
    let width = width.trim().parse::<u32>().ok()?;
    let height = height.trim().parse::<u32>().ok()?;
    if width == 0 || height == 0 {
        return None;
    }
    Some((width, height))
}

impl Default for Drivers {
    fn default() -> Self {
        Self {
            st3215: Some(St3215Config::default()),
            system_info: true,
            usb_video: Some(UsbVideoConfig::default()),
            yahboom_dogzilla_lite: None,
            ov5647: None,
        }
    }
}

impl Config {
    /// Load configuration from a YAML file
    pub fn from_file<P: AsRef<Path>>(path: P) -> Result<Self, Box<dyn std::error::Error>> {
        let contents = std::fs::read_to_string(path)?;
        let config: Config = serde_yaml::from_str(&contents)?;
        Ok(config)
    }

    /// Save configuration to a YAML file
    pub fn to_file<P: AsRef<Path>>(&self, path: P) -> Result<(), Box<dyn std::error::Error>> {
        let yaml = serde_yaml::to_string(self)?;
        std::fs::write(path, yaml)?;
        Ok(())
    }

    /// Load configuration from file or create default if file doesn't exist
    pub fn load_or_default<P: AsRef<Path>>(path: P) -> Result<Self, Box<dyn std::error::Error>> {
        let path = path.as_ref();
        if path.exists() {
            Self::from_file(path)
        } else {
            let config = Self::default();
            config.to_file(path)?;
            Ok(config)
        }
    }
}
