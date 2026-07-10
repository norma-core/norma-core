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

    /// Trampa VESC serial board configuration
    #[serde(rename = "vesc-trampa", skip_serializing_if = "Option::is_none")]
    pub vesc_trampa: Option<VescTrampaConfig>,

    /// Enable or disable system info monitoring
    #[serde(rename = "system-info")]
    pub system_info: bool,

    #[serde(rename = "usb-video", skip_serializing_if = "Option::is_none")]
    pub usb_video: Option<UsbVideoConfig>,

    #[serde(rename = "hikmicro-thermal", skip_serializing_if = "Option::is_none")]
    pub hikmicro_thermal: Option<HikmicroThermalConfig>,

    #[serde(
        rename = "yahboom-dogzilla-lite",
        skip_serializing_if = "Option::is_none"
    )]
    pub yahboom_dogzilla_lite: Option<YahboomDogzillaLiteConfig>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ov5647: Option<Ov5647Config>,

    #[serde(
        rename = "arduino-nicla-sense-env",
        skip_serializing_if = "Option::is_none"
    )]
    pub arduino_nicla_sense_env: Option<ArduinoNiclaSenseEnvConfig>,

    #[serde(rename = "ina226", skip_serializing_if = "Option::is_none")]
    pub ina226: Option<Ina226Config>,
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
    #[serde(
        rename = "motor-current-thresholds",
        default,
        skip_serializing_if = "Option::is_none"
    )]
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

/// Trampa VESC serial board configuration
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VescTrampaConfig {
    /// Enable or disable the VESC Trampa driver
    #[serde(default = "default_vesc_trampa_enabled")]
    pub enabled: bool,

    /// Serial baud rate used for matching VESC board ports.
    #[serde(
        rename = "port-baud-rate",
        default = "default_vesc_trampa_port_baud_rate"
    )]
    pub port_baud_rate: u32,
}

fn default_vesc_trampa_enabled() -> bool {
    true
}

fn default_vesc_trampa_port_baud_rate() -> u32 {
    115_200
}

impl Default for VescTrampaConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            port_baud_rate: default_vesc_trampa_port_baud_rate(),
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
    #[serde(
        rename = "update-interval",
        with = "humantime_serde",
        default = "default_update_interval"
    )]
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

    /// Requested camera capture resolution: "auto" or "<width>x<height>".
    /// Selects which camera format to open; does not affect the stored frame
    /// size, which `resize_target` controls. An unparseable value logs a
    /// warning at startup and behaves as "auto".
    #[serde(default = "default_resolution")]
    pub resolution: String,

    /// Drop this many frames after each frame that is kept, so 1 of every
    /// `frame_skip + 1` frames is recorded. Default 0 keeps every frame.
    #[serde(rename = "frame-skip", default)]
    pub frame_skip: u32,
}

fn default_resize_target() -> u32 {
    224
}

fn default_resolution() -> String {
    "auto".to_string()
}

impl Default for UsbVideoConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            resize_target: 224,
            resolution: default_resolution(),
            frame_skip: 0,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HikmicroThermalConfig {
    #[serde(default)]
    pub enabled: bool,

    #[serde(
        rename = "frame-timeout",
        with = "humantime_serde",
        default = "default_hikmicro_thermal_frame_timeout"
    )]
    pub frame_timeout: std::time::Duration,
}

fn default_hikmicro_thermal_frame_timeout() -> std::time::Duration {
    std::time::Duration::from_secs(5)
}

impl Default for HikmicroThermalConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            frame_timeout: default_hikmicro_thermal_frame_timeout(),
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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ArduinoNiclaSenseEnvConfig {
    #[serde(default)]
    pub enabled: bool,

    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub boards: Vec<ArduinoNiclaSenseEnvBoardConfig>,

    #[serde(
        default = "default_arduino_nicla_sense_env_poll_interval",
        rename = "poll-interval",
        with = "humantime_serde"
    )]
    pub poll_interval: std::time::Duration,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ArduinoNiclaSenseEnvBoardConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,

    #[serde(rename = "i2c-bus")]
    pub i2c_bus: u32,
}

fn default_arduino_nicla_sense_env_poll_interval() -> std::time::Duration {
    std::time::Duration::from_secs(1)
}

impl Default for ArduinoNiclaSenseEnvConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            boards: Vec::new(),
            poll_interval: default_arduino_nicla_sense_env_poll_interval(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Ina226Config {
    #[serde(default)]
    pub enabled: bool,

    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub devices: Vec<Ina226DeviceConfig>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Ina226DeviceConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,

    #[serde(rename = "i2c-bus")]
    pub i2c_bus: u32,

    #[serde(rename = "i2c-address")]
    pub i2c_address: u16,

    #[serde(
        rename = "shunt-resistance-ohms",
        alias = "r",
        alias = "R",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub shunt_resistance_ohms: Option<f64>,
}

impl Default for Ina226Config {
    fn default() -> Self {
        Self {
            enabled: false,
            devices: Vec::new(),
        }
    }
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
            vesc_trampa: Some(VescTrampaConfig::default()),
            system_info: true,
            usb_video: Some(UsbVideoConfig::default()),
            hikmicro_thermal: None,
            yahboom_dogzilla_lite: None,
            ov5647: None,
            arduino_nicla_sense_env: None,
            ina226: None,
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

#[cfg(test)]
mod usb_video_config_tests {
    use super::UsbVideoConfig;

    #[test]
    fn test_defaults_when_only_enabled_is_given() {
        let cfg: UsbVideoConfig = serde_yaml::from_str("enabled: true").unwrap();
        assert!(cfg.enabled);
        assert_eq!(cfg.resize_target, 224);
        assert_eq!(cfg.resolution, "auto");
        assert_eq!(cfg.frame_skip, 0);
    }

    #[test]
    fn test_parses_resolution_and_frame_skip() {
        let yaml = "enabled: true\nresolution: \"1280x720\"\nframe-skip: 2\n";
        let cfg: UsbVideoConfig = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(cfg.resolution, "1280x720");
        assert_eq!(cfg.frame_skip, 2);
    }

    #[test]
    fn test_resize_target_accepts_both_spellings() {
        let snake: UsbVideoConfig =
            serde_yaml::from_str("enabled: true\nresize_target: 128\n").unwrap();
        assert_eq!(snake.resize_target, 128);

        let kebab: UsbVideoConfig =
            serde_yaml::from_str("enabled: true\nresize-target: 128\n").unwrap();
        assert_eq!(kebab.resize_target, 128);
    }

    #[test]
    fn test_bad_resolution_string_still_deserializes() {
        // Validation happens at the usbvideo boundary, not in serde,
        // so a typo must never block startup.
        let cfg: UsbVideoConfig =
            serde_yaml::from_str("enabled: true\nresolution: \"720p\"\n").unwrap();
        assert_eq!(cfg.resolution, "720p");
    }
}
