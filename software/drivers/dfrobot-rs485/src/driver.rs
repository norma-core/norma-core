use crate::sensors::SensorModel;
use normfs::NormFS;
use station_iface::StationEngine;
use std::sync::Arc;
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct DfrobotRs485DriverConfig {
    pub ports: Vec<String>,
    pub baud: u32,
    pub poll_interval: Duration,
    pub sensors: Vec<DfrobotSensorConfig>,
}

#[derive(Debug, Clone)]
pub struct DfrobotSensorConfig {
    pub id: Option<String>,
    pub model: SensorModel,
    pub modbus_id: u8,
}

pub struct DfrobotRs485Driver {}

pub async fn start_dfrobot_rs485_driver<T: StationEngine>(
    _normfs: Arc<NormFS>,
    _station_engine: Arc<T>,
    _config: DfrobotRs485DriverConfig,
) -> Result<Arc<DfrobotRs485Driver>, Box<dyn std::error::Error + Send + Sync>> {
    unimplemented!("Task 4")
}
