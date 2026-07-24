use serde::{Deserialize, Deserializer, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Config {
    pub drivers: Drivers,

    #[serde(
        default,
        deserialize_with = "deserialize_inference_configs",
        skip_serializing_if = "Option::is_none"
    )]
    pub inference: Option<Vec<Inference>>,

    #[serde(rename = "cloud-offload", skip_serializing_if = "Option::is_none")]
    pub cloud_offload: Option<CloudOffloadConfig>,
}

fn deserialize_inference_configs<'de, D>(
    deserializer: D,
) -> Result<Option<Vec<Inference>>, D::Error>
where
    D: Deserializer<'de>,
{
    let inference = Option::<Vec<Inference>>::deserialize(deserializer)?;
    Ok(Some(inference.unwrap_or_default()))
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

    #[serde(
        rename = "airgradient-open-air-o-1pst",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub airgradient_open_air_o_1pst: Option<AirGradientOpenAirO1pstConfig>,

    #[serde(
        rename = "victron-smartsolar-mppt",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub victron_smartsolar_mppt: Option<VictronSmartSolarMpptConfig>,
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
    #[serde(default = "default_resize_target", alias = "resize-target")]
    pub resize_target: u32,

    /// Ordered camera capture format preferences. Each entry's `format` field
    /// must use "<resolution>@<fps>,<format>", for example
    /// "1024x768@20fps,mjpeg". An empty list uses automatic format selection.
    #[serde(default)]
    pub formats: Vec<UsbVideoFormatConfig>,

    /// Drop this many frames after each frame that is kept, so 1 of every
    /// `frame_skip + 1` frames is recorded. Default 0 keeps every frame.
    #[serde(rename = "frame-skip", default)]
    pub frame_skip: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq, Eq)]
pub struct UsbVideoFormatConfig {
    /// Complete capture format preference. Kept as a string for now so the
    /// per-entry object can grow additional fields later.
    #[serde(default)]
    pub format: String,
}

fn default_resize_target() -> u32 {
    224
}

impl Default for UsbVideoConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            resize_target: 224,
            formats: Vec::new(),
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

    /// Drop this many frames after each frame that is kept, so 1 of every
    /// `frame_skip + 1` frames is recorded. Default 0 keeps every frame.
    #[serde(rename = "frame-skip", default)]
    pub frame_skip: u32,
}

fn default_hikmicro_thermal_frame_timeout() -> std::time::Duration {
    std::time::Duration::from_secs(5)
}

impl Default for HikmicroThermalConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            frame_timeout: default_hikmicro_thermal_frame_timeout(),
            frame_skip: 0,
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

/// AirGradient Open Air O-1PST air-quality sensor (USB serial).
/// The sensor is located by USB auto-detection.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AirGradientOpenAirO1pstConfig {
    #[serde(default)]
    pub enabled: bool,

    #[serde(
        rename = "read-timeout",
        with = "humantime_serde",
        default = "default_airgradient_open_air_o_1pst_read_timeout"
    )]
    pub read_timeout: std::time::Duration,
}

fn default_airgradient_open_air_o_1pst_read_timeout() -> std::time::Duration {
    std::time::Duration::from_secs(10)
}

impl Default for AirGradientOpenAirO1pstConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            read_timeout: default_airgradient_open_air_o_1pst_read_timeout(),
        }
    }
}

/// Victron SmartSolar MPPT solar charge controller (VE.Direct over USB).
/// The charger is located by USB auto-detection.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VictronSmartSolarMpptConfig {
    #[serde(default)]
    pub enabled: bool,

    #[serde(
        rename = "read-timeout",
        with = "humantime_serde",
        default = "default_victron_smartsolar_mppt_read_timeout"
    )]
    pub read_timeout: std::time::Duration,
}

fn default_victron_smartsolar_mppt_read_timeout() -> std::time::Duration {
    std::time::Duration::from_secs(10)
}

impl Default for VictronSmartSolarMpptConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            read_timeout: default_victron_smartsolar_mppt_read_timeout(),
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
            airgradient_open_air_o_1pst: None,
            victron_smartsolar_mppt: None,
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
mod config_tests {
    use super::Config;

    const MINIMAL_CONFIG: &str = "drivers:\n  system-info: true\n";

    #[test]
    fn omitted_inference_config_stays_unspecified() {
        let cfg: Config = serde_yaml::from_str(MINIMAL_CONFIG).unwrap();
        assert!(cfg.inference.is_none());
    }

    #[test]
    fn bare_inference_config_is_explicitly_empty() {
        let cfg: Config =
            serde_yaml::from_str("drivers:\n  system-info: true\ninference:\n").unwrap();
        assert_eq!(cfg.inference.as_ref().map(Vec::len), Some(0));
    }

    #[test]
    fn empty_inference_list_is_explicitly_empty() {
        let cfg: Config =
            serde_yaml::from_str("drivers:\n  system-info: true\ninference: []\n").unwrap();
        assert_eq!(cfg.inference.as_ref().map(Vec::len), Some(0));
    }

    #[test]
    fn default_config_still_creates_normvla_inference() {
        let cfg = Config::default();
        assert_eq!(cfg.inference.as_ref().map(Vec::len), Some(1));
    }

    #[test]
    fn parses_airgradient_open_air_o_1pst_config() {
        let cfg: Config = serde_yaml::from_str(
            "drivers:\n  system-info: true\n  airgradient-open-air-o-1pst:\n    enabled: true\ninference:\n",
        )
        .unwrap();
        let airgradient = cfg.drivers.airgradient_open_air_o_1pst.unwrap();
        assert!(airgradient.enabled);
        assert_eq!(airgradient.read_timeout, std::time::Duration::from_secs(10));
        assert_eq!(cfg.inference.as_ref().map(Vec::len), Some(0));
    }

    #[test]
    fn parses_victron_smartsolar_mppt_config() {
        let cfg: Config = serde_yaml::from_str(
            "drivers:\n  system-info: true\n  victron-smartsolar-mppt:\n    enabled: true\n    read-timeout: 30s\ninference:\n",
        )
        .unwrap();
        let victron = cfg.drivers.victron_smartsolar_mppt.unwrap();
        assert!(victron.enabled);
        assert_eq!(victron.read_timeout, std::time::Duration::from_secs(30));
        assert_eq!(cfg.inference.as_ref().map(Vec::len), Some(0));
    }
}

#[cfg(test)]
mod usb_video_config_tests {
    use super::{UsbVideoConfig, UsbVideoFormatConfig};

    #[test]
    fn test_defaults_when_only_enabled_is_given() {
        let cfg: UsbVideoConfig = serde_yaml::from_str("enabled: true").unwrap();
        assert!(cfg.enabled);
        assert_eq!(cfg.resize_target, 224);
        assert!(cfg.formats.is_empty());
        assert_eq!(cfg.frame_skip, 0);
    }

    #[test]
    fn test_parses_formats_and_frame_skip() {
        let yaml = "enabled: true\nformats:\n  - format: \"1280x720@30fps,mjpeg\"\nframe-skip: 2\n";
        let cfg: UsbVideoConfig = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(
            cfg.formats,
            vec![UsbVideoFormatConfig {
                format: "1280x720@30fps,mjpeg".to_string(),
            }]
        );
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
    fn test_bad_format_string_still_deserializes() {
        // Validation happens at the usbvideo boundary, not in serde,
        // so a typo must never block startup.
        let cfg: UsbVideoConfig =
            serde_yaml::from_str("enabled: true\nformats:\n  - format: \"720p\"\n").unwrap();
        assert_eq!(
            cfg.formats,
            vec![UsbVideoFormatConfig {
                format: "720p".to_string(),
            }]
        );
    }
}

#[cfg(test)]
mod hikmicro_thermal_config_tests {
    use super::HikmicroThermalConfig;

    #[test]
    fn test_defaults_when_only_enabled_is_given() {
        let cfg: HikmicroThermalConfig = serde_yaml::from_str("enabled: true").unwrap();
        assert!(cfg.enabled);
        assert_eq!(cfg.frame_timeout, std::time::Duration::from_secs(5));
        assert_eq!(cfg.frame_skip, 0);
    }

    #[test]
    fn test_parses_frame_timeout_and_frame_skip() {
        let yaml = "enabled: true\nframe-timeout: 2s\nframe-skip: 3\n";
        let cfg: HikmicroThermalConfig = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(cfg.frame_timeout, std::time::Duration::from_secs(2));
        assert_eq!(cfg.frame_skip, 3);
    }
}
