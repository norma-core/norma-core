use std::{
    collections::{BTreeSet, HashMap},
    sync::Arc,
};

use normfs::UintN;
use prost::Message;
use tokio::sync::{mpsc, oneshot};
use std::sync::atomic::Ordering;

use normfs::{ReadPosition, ReadEntry};

use crate::{
    calibrate,
    protocol::{normal_position, EepromRegister, RamRegister, ServoError},
    st3215_proto::{MetaEnvelope, MetaEnvelopeType, MotorArc, RxEnvelope, St3215SignalType},
    state::ST3215BusCommunicator,
};

pub struct St3215PortMeta {
    target_port_serial: String,
    comm: Arc<ST3215BusCommunicator>,
}

impl St3215PortMeta {
    pub fn get_communicator(&self) -> &Arc<ST3215BusCommunicator> {
        &self.comm
    }

    pub async fn new(
        target_port_serial: &str,
        comm: &Arc<ST3215BusCommunicator>,
    ) -> Result<Self, normfs::Error> {
        // Read latest 1024 entries
        let (target_tx, mut target_rx) = mpsc::channel::<ReadEntry>(1);
        let (result_tx, result_rx) = oneshot::channel::<Option<MetaEnvelope>>();
        let serial = target_port_serial.to_string();
        tokio::spawn(async move {
            let mut res = None;
            while let Some(entry) = target_rx.recv().await {
                let meta = MetaEnvelope::decode(entry.data);
                if meta.is_err() {
                    log::warn!(
                        "Failed to decode meta envelope at id {:?}: {:?}",
                        entry.id,
                        meta.err()
                    );
                    continue;
                }
                let meta = meta.unwrap();
                let meta_serial = &meta.bus_serial;
                if meta_serial != &serial {
                    continue;
                }

                res = Some(meta);
            }

            let _ = result_tx.send(res);
        });

        comm.normfs
            .read(
                &comm.meta_queue_id,
                ReadPosition::ShiftFromTail(UintN::U64(1024)),
                1024,
                1,
                target_tx,
            )
            .await?;

        let meta_opt = result_rx.await.unwrap();

        // now we can choose: do we need to watch meta (or reread it) or just freeze, based on meta_opt
        let (freezed, meta) = if meta_opt.is_none()
            || meta_opt
                .as_ref()
                .map(|o| o.r#type == MetaEnvelopeType::MetResetCalibration as i32)
                .unwrap_or(false)
        {
            (false, None)
        } else {
            (true, meta_opt)
        };

        if let Some(meta) = meta {
            for arc in meta.arcs {
                comm.update_bounds(
                    target_port_serial,
                    arc.motor_id,
                    arc.min_angle,
                    arc.max_angle,
                    true,
                );
            }
        }

        let res = Self {
            target_port_serial: target_port_serial.to_string(),
            comm: comm.clone(),
        };
        res.watch(freezed).await;

        Ok(res)
    }

    pub fn get_midpoint(&self, motor_id: u8) -> Option<u16> {
        Self::exec_get_midpoint(&self.comm, &self.target_port_serial, motor_id)
    }

    fn exec_get_midpoint(
        comm: &ST3215BusCommunicator,
        target_port_serial: &str,
        motor_id: u8,
    ) -> Option<u16> {
        let bounds = comm.get_bounds(target_port_serial, motor_id as u32);
        bounds.map(|(min, max, _)| {
            if max >= min {
                // Normal range
                (min + (max - min) / 2) as u16
            } else {
                // Wrapping range
                let range_size = (4096 - min) + max;
                let midpoint_offset = range_size / 2;
                ((min + midpoint_offset) & 0xFFF) as u16
            }
        })
    }

    async fn watch(&self, freezed: bool) {
        // watch for commands and rx envelope
        let mut freezed = freezed;
        let target_serial = self.target_port_serial.clone();
        let comm = self.comm.clone();

        tokio::spawn(async move {
            let normfs = comm.normfs.clone();
            let mut motor_points: HashMap<u16, BTreeSet<u16>> = HashMap::new();

            let (tx, mut rx) = mpsc::channel::<ReadEntry>(64);
            let rx_queue_id = comm.rx_queue_id.clone();
            normfs
                .read(&rx_queue_id, ReadPosition::ShiftFromTail(UintN::zero()), 0, 1, tx)
                .await
                .unwrap();

            while let Some(entry) = rx.recv().await {
                let envelope = match RxEnvelope::decode(entry.data.as_ref()) {
                    Ok(env) => env,
                    Err(e) => {
                        log::warn!("Failed to decode RxEnvelope at id {:?}: {:?}", entry.id, e);
                        continue;
                    }
                };

                if envelope.bus.as_ref().map(|b| b.serial_number.as_str())
                    != Some(target_serial.as_str())
                {
                    continue;
                }

                let signal_is_cmd =
                    envelope.signal_type == St3215SignalType::St3215CommandSuccess as i32;

                if let Some(command) = &envelope.command {
                    if signal_is_cmd && command.reset_calibration.is_some() {
                        freezed = false;
                        log::info!(
                            "Resetting calibration for all motors on bus '{}'",
                            &target_serial
                        );

                        // Stop any ongoing calibration
                        if let Some(stop_flag) = comm.get_calibration_stop(&target_serial) {
                            stop_flag.store(true, Ordering::Relaxed);
                            log::info!("Stopping ongoing calibration for reset on bus '{}'", &target_serial);
                        }

                        comm.reset_bounds(&target_serial);
                        motor_points.clear();

                        let meta_envelope = MetaEnvelope {
                            bus_serial: target_serial.clone(),
                            r#type: MetaEnvelopeType::MetResetCalibration as i32,
                            rx_uintn_ptr: entry.id.value_to_bytes(),
                            ..Default::default()
                        };
                        if let Err(e) = comm.send_meta(&meta_envelope) {
                            log::error!("Failed to send reset calibration meta: {:?}", e);
                            return;
                        }

                        // Cleanup calibration state and stop flag
                        comm.clear_calibration_stop(&target_serial);
                        comm.clear_auto_calibration(&target_serial);

                        continue;
                    }
                    if signal_is_cmd && command.freeze_calibration.is_some() {
                        freezed = true;
                        log::info!(
                            "Freezing calibration for all motors on bus '{}'",
                            &target_serial
                        );

                        let freeze_cmd = command.freeze_calibration.as_ref().unwrap();

                        // Use provided arcs if available, otherwise calculate from motor_points
                        let arcs: Vec<MotorArc> = if !freeze_cmd.arcs.is_empty() {
                            log::info!("Using {} provided motor arcs for freeze", freeze_cmd.arcs.len());

                            // Calculate centered bounds from provided arcs
                            // port.rs::freeze_calibration will use the midpoint from command to write offset
                            freeze_cmd.arcs.iter().map(|arc| {
                                let raw_min = arc.min_angle;
                                let raw_max = arc.max_angle;

                                log::info!(
                                    "Motor {}: Received raw arc min={} max={} midpoint={}",
                                    arc.motor_id, raw_min, raw_max, arc.midpoint
                                );

                                // Calculate range (handle wrap-around)
                                let range = if raw_max >= raw_min {
                                    raw_max - raw_min
                                } else {
                                    (4096 - raw_min) + raw_max
                                };

                                // Center around 2048
                                let new_min = 2048 - (range as i32 / 2);
                                let new_max = 2048 + (range as i32 / 2);

                                let new_min = (new_min + 4096) % 4096;
                                let new_max = new_max % 4096;

                                let new_min = new_min as u32;
                                let new_max = new_max as u32;

                                log::info!(
                                    "Motor {}: Centered bounds min={} max={} (range={})",
                                    arc.motor_id, new_min, new_max, range
                                );

                                // Update bounds with centered values
                                comm.update_bounds(
                                    &target_serial,
                                    arc.motor_id,
                                    new_min,
                                    new_max,
                                    true,  // Frozen
                                );

                                // Return centered arc for meta envelope
                                MotorArc {
                                    motor_id: arc.motor_id,
                                    min_angle: new_min,
                                    max_angle: new_max,
                                    range_freezed: true,
                                    positions: vec![],
                                }
                            }).collect()
                        } else {
                            log::info!("No arcs provided, calculating from motor_points");

                            // Original behavior: calculate from tracked motor_points
                            motor_points
                                .keys()
                                .map(|motor_id| {
                                    let bounds = comm.get_bounds(&target_serial, *motor_id as u32);
                                    let (range_min, range_max, _) = bounds.unwrap();

                                    let range = if range_min < range_max {
                                        range_max - range_min
                                    } else {
                                        (4096 - range_min) + range_max
                                    };

                                    let new_min = 2048 - (range as i32 / 2);
                                    let new_max = 2048 + (range as i32 / 2);

                                    let new_min = (new_min + 4096) % 4096;
                                    let new_max = new_max % 4096;

                                    let new_min = new_min as u32;
                                    let new_max = new_max as u32;

                                    comm.update_bounds(
                                        &target_serial,
                                        *motor_id as u32,
                                        new_min,
                                        new_max,
                                        true,
                                    );

                                    MotorArc {
                                        motor_id: *motor_id as u32,
                                        min_angle: new_min,
                                        max_angle: new_max,
                                        range_freezed: true,
                                        positions: vec![],
                                    }
                                })
                                .collect()
                        };

                        let meta_envelope = MetaEnvelope {
                            bus_serial: target_serial.clone(),
                            r#type: MetaEnvelopeType::MetFreezeCalibration as i32,
                            rx_uintn_ptr: entry.id.value_to_bytes(),
                            arcs,
                            ..Default::default()
                        };
                        if let Err(e) = comm.send_meta(&meta_envelope) {
                            log::error!("Failed to send freeze calibration meta: {:?}", e);
                            return;
                        }
                        motor_points.clear();

                        // Cleanup calibration state and stop flag
                        comm.clear_calibration_stop(&target_serial);
                        comm.clear_auto_calibration(&target_serial);

                        continue;
                    }
                    if signal_is_cmd && command.stop_auto_calibrate.is_some() {
                        log::info!(
                            "Stop auto-calibration command received for bus '{}'",
                            &target_serial
                        );
                        if let Some(stop_flag) = comm.get_calibration_stop(&target_serial) {
                            stop_flag.store(true, Ordering::Relaxed);
                            log::info!("Auto-calibration stop flag set for bus '{}'", &target_serial);
                            // Clean up the stop flag from storage
                            comm.clear_calibration_stop(&target_serial);
                        } else {
                            log::warn!("No active auto-calibration found for bus '{}'", &target_serial);
                        }
                        continue;
                    }
                }

                let signal_type = match St3215SignalType::try_from(envelope.signal_type) {
                    Ok(t) => t,
                    Err(_) => continue,
                };

                if signal_type == St3215SignalType::St3215DriveState {
                    if freezed {
                        continue;
                    }

                    if envelope.error.is_some() {
                        continue;
                    }

                    let mode_addr = EepromRegister::Mode.address() as usize;
                    if envelope.data.len() <= mode_addr {
                        continue;
                    }
                    if envelope.data[mode_addr] != 0 {
                        // Not in servo mode
                        continue;
                    }

                    let status_addr = RamRegister::Status.address() as usize;
                    if envelope.data.len() <= status_addr {
                        continue;
                    }
                    let status_bits = envelope.data[status_addr];
                    if let Some(errors) = ServoError::from_bits(status_bits) {
                        let errors: Vec<ServoError> = errors
                            .into_iter()
                            .filter(|e| *e != ServoError::Voltage)
                            .collect();
                        if !errors.is_empty() {
                            log::warn!(
                                "Motor {} has errors: {:?}, skip calibration data",
                                envelope.motor_id,
                                errors
                            );
                            continue;
                        }
                    }

                    let position_addr = RamRegister::PresentPosition.address() as usize;
                    if envelope.data.len() < position_addr + 2 {
                        continue;
                    }

                    let offset_addr = EepromRegister::Offset.address() as usize;
                    if envelope.data.len() < offset_addr + 2 {
                        continue;
                    }

                    let motor_id = envelope.motor_id as u16;
                    let position_bytes: [u8; 2] =
                        match envelope.data[position_addr..position_addr + 2].try_into() {
                            Ok(b) => b,
                            Err(_) => continue,
                        };
                    let offset_bytes: [u8; 2] =
                        match envelope.data[offset_addr..offset_addr + 2].try_into() {
                            Ok(b) => b,
                            Err(_) => continue,
                        };
                    
                    let offset = i16::from_le_bytes(offset_bytes);
                    let position = normal_position(u16::from_le_bytes(position_bytes));
                    let position = ((position as i32 + offset as i32 + 4096) % 4096) as u16;

                    let points = motor_points.entry(motor_id).or_default();
                    if points.insert(position) {
                        let cal_arc = calibrate::calculate_arc(points);
                        log::debug!(
                            "Motor {}: new point position={} offset={} range_min={} range_max={}",
                            motor_id, position, offset, cal_arc.min, cal_arc.max
                        );
                        comm.update_bounds(
                            &target_serial,
                            motor_id as u32,
                            cal_arc.min as u32,
                            cal_arc.max as u32,
                            false,
                        );
                    }
                }
            }
        });
    }
}
