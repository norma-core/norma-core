#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum SensorModel {
    Irradiance,
    Par,
    Uv,
    Light,
}
