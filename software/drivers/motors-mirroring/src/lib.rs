use std::{collections::HashMap, sync::{Arc, RwLock}};

use prost::Message;
use station_iface::{
    Backpressure, StationEngine, try_enqueue_with,
    iface_proto::{commands::StationCommandsPack, drivers}
};
use normfs::NormFS;
use tokio::sync::mpsc;
use normfs::UintN;

use crate::{inference::Inference, proto::mirroring::{self, ModeEnvelope}};

pub mod proto {
    pub mod mirroring {
        include!("proto/motors_mirroring.rs");
    }
}

pub mod config;
mod r#types;
mod inference;

use r#types::BusKey;

const MODES_QUEUE_ID: &str = "motors_mirroring/modes";
const RX_QUEUE_ID: &str = "inference/mirroring";

pub async fn start<T: StationEngine>(
    normfs: Arc<NormFS>,
    station_engine: Arc<T>,
    motor_config: config::MotorConfig,
) -> Result<(), normfs::Error> {
        let modes_queue_id = normfs.resolve(MODES_QUEUE_ID);
        let rx_queue_id = normfs.resolve(RX_QUEUE_ID);

        normfs.ensure_queue_exists_for_write(&modes_queue_id).await?;
        normfs.ensure_queue_exists_for_write(&rx_queue_id).await?;

        station_engine.register_queue(
            &modes_queue_id,
            drivers::QueueDataType::QdtMotorMirroringModes,
            vec![],
        );

        station_engine.register_queue(
            &rx_queue_id,
            drivers::QueueDataType::QdtMotorMirroringRx,
            vec![],
        );

        let modes = Arc::new(RwLock::new(HashMap::new()));

        let task_modes = modes.clone();
        let reading_normfs = normfs.clone();
        let task_normfs = normfs.clone();
        let task_rx_queue_id = rx_queue_id.clone();

        let inf = Arc::new(inference::Inference::new(motor_config, normfs.clone()).await?);
        let read_inf = inf.clone();

        // Clone references for the command handler closure
        let cmd_modes = modes.clone();
        let cmd_inf = inf.clone();
        let cmd_normfs = normfs.clone();
        let cmd_rx_queue_id = rx_queue_id;

        let modes_queue_id_clone = modes_queue_id.clone();
        tokio::spawn(async move {
            let mut read_modes = HashMap::new();

            let (tx, mut rx) = mpsc::channel(1);

            tokio::spawn(async move {
                let _ = reading_normfs
                    .read(&modes_queue_id_clone, normfs::ReadPosition::ShiftFromTail(UintN::from(1024u64)), 1024, 1, tx)
                    .await;
            });

            while let Some(entry) = rx.recv().await {
                match ModeEnvelope::decode(entry.data) {
                    Ok(envelope) => {
                        if let Some(bus) = envelope.bus {
                            let bus_id = bus.unique_id.clone();
                            let bus_type = match mirroring::BusType::try_from(bus.r#type) {
                                Ok(bt) => bt,
                                Err(_) => continue,
                            };
                            let mode_type = match mirroring::BusMode::try_from(envelope.mode) {
                                Ok(rt) => rt,
                                Err(_) => continue,
                            };

                            read_modes.insert(BusKey { bus_id, bus_type }, mode_type);
                        }
                    }
                    Err(e) => {
                        log::error!("Error decoding mode envelope at id {}: {:?}", entry.id, e);
                    }
                }
            }

            log::info!("Restored {} bus modes from normfs", read_modes.len());

            let mut current_modes = task_modes.write().unwrap();
            merge_modes(&mut current_modes, &read_modes, &read_inf, &task_normfs, &task_rx_queue_id, None);
        });

        let commands_queue_id = normfs.resolve("commands");
        normfs.subscribe(&commands_queue_id, Box::new(move |entries: &[(UintN, bytes::Bytes)]| {
            for (_, data) in entries {
                if let Ok(pack) = StationCommandsPack::decode(data.as_ref()) {
                    process_command_pack(&pack, &cmd_modes, &cmd_inf, &cmd_normfs, &cmd_rx_queue_id);
                }
            }
            true
        }))?;

        Ok(())
}

fn merge_modes(
        current: &mut HashMap<BusKey, mirroring::BusMode>,
        new_modes: &HashMap<BusKey, mirroring::BusMode>,
        inference: &Inference,
        normfs: &NormFS,
        rx_queue_id: &normfs::QueueId,
        command: Option<mirroring::Command>,
    ) {
        for (key, value) in new_modes {
            current.insert(key.clone(), *value);
        }

        let bus_modes = current
            .clone()
            .into_iter()
            .map(|(key, value)| proto::mirroring::inference_state::Bus {
                id: Some(proto::mirroring::MirroringBus {
                    unique_id: key.bus_id,
                    r#type: key.bus_type as i32,
                }),
                mode: value as i32,
            })
            .collect();

        let inference_state = mirroring::InferenceState {
            modes: bus_modes,
            mirroring: inference.get_mirrorings(),
        };

        // Create RxEnvelope and write to RX queue
        let rx_envelope = mirroring::RxEnvelope {
            monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
            local_stamp_ns: systime::get_local_stamp_ns(),
            app_start_id: systime::get_app_start_id(),
            state: Some(inference_state.clone()),
            command,
        };

        // May run inside the commands subscriber callback; must not block.
        if let Err(e) = try_enqueue_with(normfs, rx_queue_id, rx_envelope.encode_to_vec().into(), Backpressure::Keep) {
            log::error!("Failed to publish mirroring state: {}", e);
        }
    }

    fn process_command_pack(
        pack: &StationCommandsPack,
        modes: &Arc<RwLock<HashMap<BusKey, mirroring::BusMode>>>,
        inference: &Arc<Inference>,
        normfs: &NormFS,
        rx_queue_id: &normfs::QueueId,
    ) {
        log::debug!("Received command pack: {:?}", pack.pack_id);

        for command in &pack.commands {
            let command_type = command.r#type();
            let body = &command.body;

            if command_type != station_iface::iface_proto::drivers::StationCommandType::StcMotorMirroringCommand {
                continue;
            }

            let command = match mirroring::Command::decode(body.clone()) {
                Ok(command) => command,
                Err(e) => {
                    log::error!("Failed to decode mirroring command: {}", e);
                    continue;
                }
            };

            if command.r#type == mirroring::CommandType::CtStopMirror as i32 {
                handle_stop_mirror(command, modes, inference, normfs, rx_queue_id);
            } else if command.r#type == mirroring::CommandType::CtStartMirror as i32 {
                handle_start_mirror(command, modes, inference, normfs, rx_queue_id);
            }
        }
    }

    fn handle_stop_mirror(
        command: mirroring::Command,
        modes: &Arc<RwLock<HashMap<BusKey, mirroring::BusMode>>>,
        inference: &Arc<Inference>,
        normfs: &NormFS,
        rx_queue_id: &normfs::QueueId,
    ) {
        let source_bus = match &command.source {
            Some(bus) => {
                let bus_id = &bus.unique_id;
                let bus_type = match mirroring::BusType::try_from(bus.r#type) {
                    Ok(bt) => bt,
                    Err(_) => {
                        log::warn!(
                            "Unknown bus type for mirroring stop command: bus_id={}, type={}",
                            bus_id,
                            bus.r#type
                        );
                        return;
                    }
                };

                BusKey {
                    bus_id: bus_id.clone(),
                    bus_type,
                }
            },
            None => {
                log::warn!("Mirroring stop command missing source bus");
                return;
            }
        };

        log::info!("Stopping mirroring for source bus: {:?}", source_bus);

        inference.stop(source_bus);

        let mut modes_guard = modes.write().unwrap();
        merge_modes(&mut modes_guard, &HashMap::new(), inference, normfs, rx_queue_id, Some(command));
    }

    fn handle_start_mirror(
        command: mirroring::Command,
        modes: &Arc<RwLock<HashMap<BusKey, mirroring::BusMode>>>,
        inference: &Arc<Inference>,
        normfs: &NormFS,
        rx_queue_id: &normfs::QueueId,
    ) {
        log::info!("Starting mirroring with command: {:?}", command);

        let mut new_modes = HashMap::new();

        // sources are leaders
        let source = match &command.source {
            Some(bus) => {
                let bus_id = &bus.unique_id;
                let bus_type = match mirroring::BusType::try_from(bus.r#type) {
                    Ok(bt) => bt,
                    Err(_) => {
                        log::warn!(
                            "Unknown bus type for mirroring command: bus_id={}, type={}",
                            bus_id,
                            bus.r#type
                        );
                        return;
                    }
                };

                let source_key = BusKey {
                    bus_id: bus_id.clone(),
                    bus_type,
                };

                new_modes.insert(
                    source_key.clone(),
                    mirroring::BusMode::BrLeader,
                );

                source_key
            },
            None => {
                log::warn!("Mirroring command missing source bus");
                return;
            }
        };

        // targets are followers
        let mut targets_keys: Vec<BusKey> = vec![];
        for target in &command.targets {
            let bus_id = &target.unique_id;
            let bus_type = match mirroring::BusType::try_from(target.r#type) {
                Ok(bt) => bt,
                Err(_) => {
                    log::warn!(
                        "Unknown bus type for mirroring command target: bus_id={}, type={}",
                        bus_id,
                        target.r#type
                    );
                    continue;
                }
            };

            let target_key = BusKey {
                bus_id: bus_id.clone(),
                bus_type,
            };

            targets_keys.push(target_key.clone());
            new_modes.insert(target_key, mirroring::BusMode::BrFollower);
        }

        inference.start(source, targets_keys);

        let mut modes_guard = modes.write().unwrap();
        merge_modes(&mut modes_guard, &new_modes, inference, normfs, rx_queue_id, Some(command));
    }