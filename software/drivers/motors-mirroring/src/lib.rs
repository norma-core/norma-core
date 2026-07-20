use std::{collections::HashMap, sync::{Arc, RwLock}};

use prost::Message;
use station_iface::{
    StationEngine, iface_proto::{commands::StationCommandsPack, drivers}
};
use normfs::NormFS;
use tokio::sync::mpsc;
use normfs::UintN;

use crate::{
    config::{clamp_gravity_comp_gain, clamp_gravity_comp_torque_limit},
    gravity_comp::GravitySettings,
    inference::Inference,
    proto::mirroring::{self, ModeEnvelope, GravityCompModeEnvelope, GravityCompSettingsEnvelope},
};

pub mod proto {
    pub mod mirroring {
        include!("proto/motors_mirroring.rs");
    }
}

pub mod config;
mod r#types;
pub mod inference;
mod gravity_comp;

use r#types::BusKey;

const MODES_QUEUE_ID: &str = "motors_mirroring/modes";
const GRAVITY_MODES_QUEUE_ID: &str = "motors_mirroring/gravity_comp_modes";
const GRAVITY_SETTINGS_QUEUE_ID: &str = "motors_mirroring/gravity_comp_settings";
const RX_QUEUE_ID: &str = "inference/mirroring";

type ModesMap = Arc<RwLock<HashMap<BusKey, mirroring::BusMode>>>;
type GravityModesMap = Arc<RwLock<HashMap<BusKey, mirroring::GravityCompState>>>;
type GravitySettingsMap = Arc<RwLock<HashMap<BusKey, GravitySettings>>>;

/// Returns the shared `Inference` handle so callers (e.g. the station
/// binary's shutdown sequence) can explicitly stop any running gravity-comp
/// tasks - and thus disable torque on their buses - before the process
/// exits, rather than leaving it to implicit task-drop when the runtime
/// tears down.
pub async fn start<T: StationEngine>(
    normfs: Arc<NormFS>,
    station_engine: Arc<T>,
    motor_config: config::MotorConfig,
) -> Result<Arc<Inference>, normfs::Error> {
        let modes_queue_id = normfs.resolve(MODES_QUEUE_ID);
        let gravity_modes_queue_id = normfs.resolve(GRAVITY_MODES_QUEUE_ID);
        let gravity_settings_queue_id = normfs.resolve(GRAVITY_SETTINGS_QUEUE_ID);
        let rx_queue_id = normfs.resolve(RX_QUEUE_ID);

        normfs.ensure_queue_exists_for_write(&modes_queue_id).await?;
        normfs.ensure_queue_exists_for_write(&gravity_modes_queue_id).await?;
        normfs.ensure_queue_exists_for_write(&gravity_settings_queue_id).await?;
        normfs.ensure_queue_exists_for_write(&rx_queue_id).await?;

        station_engine.register_queue(
            &modes_queue_id,
            drivers::QueueDataType::QdtMotorMirroringModes,
            vec![],
        );

        station_engine.register_queue(
            &gravity_modes_queue_id,
            drivers::QueueDataType::QdtMotorMirroringGravityCompModes,
            vec![],
        );

        station_engine.register_queue(
            &gravity_settings_queue_id,
            drivers::QueueDataType::QdtMotorMirroringGravityCompSettings,
            vec![],
        );

        station_engine.register_queue(
            &rx_queue_id,
            drivers::QueueDataType::QdtMotorMirroringRx,
            vec![],
        );

        let modes: ModesMap = Arc::new(RwLock::new(HashMap::new()));
        let gravity_modes: GravityModesMap = Arc::new(RwLock::new(HashMap::new()));
        let gravity_settings: GravitySettingsMap = Arc::new(RwLock::new(HashMap::new()));

        let task_modes = modes.clone();
        let task_gravity_modes = gravity_modes.clone();
        let reading_normfs = normfs.clone();
        let reading_gravity_normfs = normfs.clone();
        let reading_gravity_settings_normfs = normfs.clone();
        let task_normfs = normfs.clone();
        let task_gravity_normfs = normfs.clone();
        let task_gravity_settings_normfs = normfs.clone();

        let inf = Arc::new(inference::Inference::new(
            motor_config,
            normfs.clone(),
        ));
        let read_inf = inf.clone();
        let read_gravity_inf = inf.clone();
        let read_gravity_settings_inf = inf.clone();

        // Clone references for the command handler closure
        let cmd_modes = modes.clone();
        let cmd_gravity_modes = gravity_modes.clone();
        let cmd_gravity_settings = gravity_settings.clone();
        let cmd_inf = inf.clone();
        let cmd_normfs = normfs.clone();
        let cmd_rx_queue_id = rx_queue_id.clone();
        let cmd_gravity_settings_queue_id = gravity_settings_queue_id.clone();

        let modes_queue_id_clone = modes_queue_id.clone();
        let rx_queue_id_for_mirror_restore = rx_queue_id.clone();
        let gravity_settings_for_mirror_restore = gravity_settings.clone();
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
            let mut current_gravity_modes = task_gravity_modes.write().unwrap();
            let gravity_settings_snapshot = gravity_settings_for_mirror_restore.read().unwrap().clone();
            merge_modes(
                &mut current_modes,
                &read_modes,
                &mut current_gravity_modes,
                &HashMap::new(),
                &gravity_settings_snapshot,
                &read_inf,
                &task_normfs,
                &rx_queue_id_for_mirror_restore,
                None,
                None,
            );
        });

        // Restore gravity-comp mode *display* state on boot only - deliberately
        // does NOT call `inference.start_gravity_comp()` for buses restored as
        // enabled. Gravity comp actively drives motors the instant its control
        // loop starts, unlike mirroring pairs (which are inert relationships
        // until a live mirror() loop reads fresh leader data), so silently
        // resuming it after a process restart with no fresh operator
        // confirmation would be unsafe. An explicit start command is always
        // required to actually (re-)arm it.
        let gravity_modes_queue_id_clone = gravity_modes_queue_id.clone();
        let modes_for_gravity_restore = modes.clone();
        let gravity_modes_for_gravity_restore = gravity_modes.clone();
        let rx_queue_id_for_gravity_restore = rx_queue_id.clone();
        let gravity_settings_for_gravity_restore = gravity_settings.clone();
        tokio::spawn(async move {
            let mut read_gravity_modes = HashMap::new();

            let (tx, mut rx) = mpsc::channel(1);

            tokio::spawn(async move {
                let _ = reading_gravity_normfs
                    .read(&gravity_modes_queue_id_clone, normfs::ReadPosition::ShiftFromTail(UintN::from(1024u64)), 1024, 1, tx)
                    .await;
            });

            while let Some(entry) = rx.recv().await {
                match GravityCompModeEnvelope::decode(entry.data) {
                    Ok(envelope) => {
                        if let Some(bus) = envelope.bus {
                            let bus_id = bus.unique_id.clone();
                            let bus_type = match mirroring::BusType::try_from(bus.r#type) {
                                Ok(bt) => bt,
                                Err(_) => continue,
                            };
                            let state = match mirroring::GravityCompState::try_from(envelope.state) {
                                Ok(s) => s,
                                Err(_) => continue,
                            };

                            read_gravity_modes.insert(BusKey { bus_id, bus_type }, state);
                        }
                    }
                    Err(e) => {
                        log::error!("Error decoding gravity comp mode envelope at id {}: {:?}", entry.id, e);
                    }
                }
            }

            log::info!(
                "Restored {} gravity comp bus modes from normfs (display only, not re-armed)",
                read_gravity_modes.len()
            );

            let mut current_modes = modes_for_gravity_restore.write().unwrap();
            let mut current_gravity_modes = gravity_modes_for_gravity_restore.write().unwrap();
            let gravity_settings_snapshot = gravity_settings_for_gravity_restore.read().unwrap().clone();
            merge_modes(
                &mut current_modes,
                &HashMap::new(),
                &mut current_gravity_modes,
                &read_gravity_modes,
                &gravity_settings_snapshot,
                &read_gravity_inf,
                &task_gravity_normfs,
                &rx_queue_id_for_gravity_restore,
                None,
                None,
            );
        });

        // Restore saved per-joint gains/torque limit on boot - safe to load
        // unconditionally (unlike the mode restore above): this only
        // populates displayed/pre-fill data, it never starts anything.
        let gravity_settings_queue_id_clone = gravity_settings_queue_id.clone();
        let modes_for_settings_restore = modes.clone();
        let gravity_modes_for_settings_restore = gravity_modes.clone();
        let gravity_settings_for_settings_restore = gravity_settings.clone();
        let rx_queue_id_for_settings_restore = rx_queue_id.clone();
        tokio::spawn(async move {
            let mut read_settings = HashMap::new();

            let (tx, mut rx) = mpsc::channel(1);

            tokio::spawn(async move {
                let _ = reading_gravity_settings_normfs
                    .read(&gravity_settings_queue_id_clone, normfs::ReadPosition::ShiftFromTail(UintN::from(1024u64)), 1024, 1, tx)
                    .await;
            });

            while let Some(entry) = rx.recv().await {
                match GravityCompSettingsEnvelope::decode(entry.data) {
                    Ok(envelope) => {
                        if let Some(bus) = envelope.bus {
                            let bus_id = bus.unique_id.clone();
                            let bus_type = match mirroring::BusType::try_from(bus.r#type) {
                                Ok(bt) => bt,
                                Err(_) => continue,
                            };

                            if envelope.joint_gains_rad_per_nm.len() != 7 {
                                log::warn!(
                                    "Skipping gravity comp settings for bus {} with {} joint gains (expected 7)",
                                    bus_id,
                                    envelope.joint_gains_rad_per_nm.len()
                                );
                                continue;
                            }

                            let mut joint_gains = [0.0f64; 7];
                            joint_gains.copy_from_slice(&envelope.joint_gains_rad_per_nm);

                            read_settings.insert(
                                BusKey { bus_id, bus_type },
                                GravitySettings {
                                    joint_gains,
                                    torque_limit: envelope.torque_limit as u16,
                                },
                            );
                        }
                    }
                    Err(e) => {
                        log::error!("Error decoding gravity comp settings envelope at id {}: {:?}", entry.id, e);
                    }
                }
            }

            log::info!("Restored {} gravity comp settings from normfs", read_settings.len());

            let mut current_settings = gravity_settings_for_settings_restore.write().unwrap();
            for (key, value) in &read_settings {
                current_settings.insert(key.clone(), *value);
            }

            let mut current_modes = modes_for_settings_restore.write().unwrap();
            let mut current_gravity_modes = gravity_modes_for_settings_restore.write().unwrap();
            merge_modes(
                &mut current_modes,
                &HashMap::new(),
                &mut current_gravity_modes,
                &HashMap::new(),
                &current_settings,
                &read_gravity_settings_inf,
                &task_gravity_settings_normfs,
                &rx_queue_id_for_settings_restore,
                None,
                None,
            );
        });

        let commands_queue_id = normfs.resolve("commands");
        normfs.subscribe(&commands_queue_id, Box::new(move |entries: &[(UintN, bytes::Bytes)]| {
            for (_, data) in entries {
                if let Ok(pack) = StationCommandsPack::decode(data.as_ref()) {
                    process_command_pack(
                        &pack,
                        &cmd_modes,
                        &cmd_gravity_modes,
                        &cmd_gravity_settings,
                        &cmd_inf,
                        &cmd_normfs,
                        &cmd_rx_queue_id,
                        &cmd_gravity_settings_queue_id,
                    );
                }
            }
            true
        }))?;

        Ok(inf)
}

#[allow(clippy::too_many_arguments)]
fn merge_modes(
        current: &mut HashMap<BusKey, mirroring::BusMode>,
        new_modes: &HashMap<BusKey, mirroring::BusMode>,
        gravity_current: &mut HashMap<BusKey, mirroring::GravityCompState>,
        new_gravity: &HashMap<BusKey, mirroring::GravityCompState>,
        gravity_settings: &HashMap<BusKey, GravitySettings>,
        inference: &Inference,
        normfs: &Arc<NormFS>,
        rx_queue_id: &normfs::QueueId,
        command: Option<mirroring::Command>,
        gravity_command: Option<mirroring::GravityCompCommand>,
    ) {
        for (key, value) in new_modes {
            current.insert(key.clone(), *value);
        }
        for (key, value) in new_gravity {
            gravity_current.insert(key.clone(), *value);
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

        let gravity_bus_states = gravity_current
            .clone()
            .into_iter()
            .map(|(key, value)| {
                let (joint_gains, torque_limit) = match gravity_settings.get(&key) {
                    Some(settings) => (settings.joint_gains.to_vec(), Some(settings.torque_limit as u32)),
                    None => (Vec::new(), None),
                };
                mirroring::GravityCompBusState {
                    id: Some(mirroring::MirroringBus {
                        unique_id: key.bus_id,
                        r#type: key.bus_type as i32,
                    }),
                    state: value as i32,
                    joint_gains_rad_per_nm: joint_gains,
                    torque_limit,
                }
            })
            .collect();

        let inference_state = mirroring::InferenceState {
            modes: bus_modes,
            mirroring: inference.get_mirrorings(),
            gravity_comp: gravity_bus_states,
        };

        // Create RxEnvelope and write to RX queue
        let rx_envelope = mirroring::RxEnvelope {
            monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
            local_stamp_ns: systime::get_local_stamp_ns(),
            app_start_id: systime::get_app_start_id(),
            state: Some(inference_state.clone()),
            command,
            gravity_command,
        };

        let _ = normfs.enqueue(rx_queue_id, rx_envelope.encode_to_vec().into());
    }

    #[allow(clippy::too_many_arguments)]
    fn process_command_pack(
        pack: &StationCommandsPack,
        modes: &ModesMap,
        gravity_modes: &GravityModesMap,
        gravity_settings: &GravitySettingsMap,
        inference: &Arc<Inference>,
        normfs: &Arc<NormFS>,
        rx_queue_id: &normfs::QueueId,
        gravity_settings_queue_id: &normfs::QueueId,
    ) {
        log::debug!("Received command pack: {:?}", pack.pack_id);

        for command in &pack.commands {
            let command_type = command.r#type();
            let body = &command.body;

            match command_type {
                station_iface::iface_proto::drivers::StationCommandType::StcMotorMirroringCommand => {
                    let command = match mirroring::Command::decode(body.clone()) {
                        Ok(command) => command,
                        Err(e) => {
                            log::error!("Failed to decode mirroring command: {}", e);
                            continue;
                        }
                    };

                    if command.r#type == mirroring::CommandType::CtStopMirror as i32 {
                        handle_stop_mirror(command, modes, gravity_modes, gravity_settings, inference, normfs, rx_queue_id);
                    } else if command.r#type == mirroring::CommandType::CtStartMirror as i32 {
                        handle_start_mirror(command, modes, gravity_modes, gravity_settings, inference, normfs, rx_queue_id);
                    }
                }
                station_iface::iface_proto::drivers::StationCommandType::StcGravityCompCommand => {
                    let command = match mirroring::GravityCompCommand::decode(body.clone()) {
                        Ok(command) => command,
                        Err(e) => {
                            log::error!("Failed to decode gravity comp command: {}", e);
                            continue;
                        }
                    };

                    if command.r#type == mirroring::GravityCompCommandType::GctStopGravityComp as i32 {
                        handle_stop_gravity_comp(command, modes, gravity_modes, gravity_settings, inference, normfs, rx_queue_id);
                    } else if command.r#type == mirroring::GravityCompCommandType::GctStartGravityComp as i32 {
                        handle_start_gravity_comp(command, modes, gravity_modes, gravity_settings, inference, normfs, rx_queue_id);
                    } else if command.r#type == mirroring::GravityCompCommandType::GctSetGain as i32 {
                        handle_set_gravity_comp_gain(command, modes, gravity_modes, gravity_settings, inference, normfs, rx_queue_id);
                    } else if command.r#type == mirroring::GravityCompCommandType::GctSetTorqueLimit as i32 {
                        handle_set_gravity_comp_torque_limit(command, modes, gravity_modes, gravity_settings, inference, normfs, rx_queue_id);
                    } else if command.r#type == mirroring::GravityCompCommandType::GctSaveSettings as i32 {
                        handle_save_gravity_comp_settings(command, gravity_settings, normfs, gravity_settings_queue_id);
                    }
                }
                _ => continue,
            }
        }
    }

    fn handle_stop_mirror(
        command: mirroring::Command,
        modes: &ModesMap,
        gravity_modes: &GravityModesMap,
        gravity_settings: &GravitySettingsMap,
        inference: &Arc<Inference>,
        normfs: &Arc<NormFS>,
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
        let mut gravity_guard = gravity_modes.write().unwrap();
        let gravity_settings_snapshot = gravity_settings.read().unwrap().clone();
        merge_modes(&mut modes_guard, &HashMap::new(), &mut gravity_guard, &HashMap::new(), &gravity_settings_snapshot, inference, normfs, rx_queue_id, Some(command), None);
    }

    fn handle_start_mirror(
        command: mirroring::Command,
        modes: &ModesMap,
        gravity_modes: &GravityModesMap,
        gravity_settings: &GravitySettingsMap,
        inference: &Arc<Inference>,
        normfs: &Arc<NormFS>,
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
        let mut gravity_guard = gravity_modes.write().unwrap();
        let gravity_settings_snapshot = gravity_settings.read().unwrap().clone();
        merge_modes(&mut modes_guard, &new_modes, &mut gravity_guard, &HashMap::new(), &gravity_settings_snapshot, inference, normfs, rx_queue_id, Some(command), None);
    }

    fn decode_gravity_comp_bus(bus: &Option<mirroring::MirroringBus>) -> Option<BusKey> {
        let bus = bus.as_ref()?;
        let bus_type = match mirroring::BusType::try_from(bus.r#type) {
            Ok(bt) => bt,
            Err(_) => {
                log::warn!(
                    "Unknown bus type for gravity comp command: bus_id={}, type={}",
                    bus.unique_id,
                    bus.r#type
                );
                return None;
            }
        };
        Some(BusKey { bus_id: bus.unique_id.clone(), bus_type })
    }

    /// Gets or creates this bus's staged gravity settings entry, seeded from
    /// the configured defaults if it doesn't exist yet.
    fn ensure_gravity_settings(
        gravity_settings: &GravitySettingsMap,
        bus_key: &BusKey,
        inference: &Inference,
    ) -> GravitySettings {
        let mut guard = gravity_settings.write().unwrap();
        *guard.entry(bus_key.clone()).or_insert_with(|| inference.gravity_comp_defaults())
    }

    fn handle_start_gravity_comp(
        command: mirroring::GravityCompCommand,
        modes: &ModesMap,
        gravity_modes: &GravityModesMap,
        gravity_settings: &GravitySettingsMap,
        inference: &Arc<Inference>,
        normfs: &Arc<NormFS>,
        rx_queue_id: &normfs::QueueId,
    ) {
        let bus_key = match decode_gravity_comp_bus(&command.bus) {
            Some(bus_key) => bus_key,
            None => {
                log::warn!("Gravity comp start command missing or invalid bus");
                return;
            }
        };

        // Seed from whatever's already staged/saved for this bus (or the
        // configured defaults if it's never been touched) rather than
        // always resetting to config defaults on every start.
        let settings = ensure_gravity_settings(gravity_settings, &bus_key, inference);
        log::info!(
            "Starting gravity compensation for bus: {:?} (gains={:?}, torque_limit={})",
            bus_key,
            settings.joint_gains,
            settings.torque_limit
        );

        let cb_modes = Arc::clone(modes);
        let cb_gravity_modes = Arc::clone(gravity_modes);
        let cb_gravity_settings = Arc::clone(gravity_settings);
        let cb_inference = Arc::clone(inference);
        let cb_normfs = Arc::clone(normfs);
        let cb_rx_queue_id = rx_queue_id.clone();

        inference.start_gravity_comp(bus_key.clone(), Some(settings.joint_gains), Some(settings.torque_limit), move |bus| {
            log::warn!("Gravity comp on bus {:?} self-stopped for safety; updating mode state", bus);
            deactivate_gravity_comp(bus, &cb_modes, &cb_gravity_modes, &cb_gravity_settings, &cb_inference, &cb_normfs, &cb_rx_queue_id, None);
        });

        let mut new_gravity = HashMap::new();
        new_gravity.insert(bus_key, mirroring::GravityCompState::GcEnabled);

        let mut modes_guard = modes.write().unwrap();
        let mut gravity_guard = gravity_modes.write().unwrap();
        let gravity_settings_snapshot = gravity_settings.read().unwrap().clone();
        merge_modes(&mut modes_guard, &HashMap::new(), &mut gravity_guard, &new_gravity, &gravity_settings_snapshot, inference, normfs, rx_queue_id, None, Some(command));
    }

    fn handle_stop_gravity_comp(
        command: mirroring::GravityCompCommand,
        modes: &ModesMap,
        gravity_modes: &GravityModesMap,
        gravity_settings: &GravitySettingsMap,
        inference: &Arc<Inference>,
        normfs: &Arc<NormFS>,
        rx_queue_id: &normfs::QueueId,
    ) {
        let bus_key = match decode_gravity_comp_bus(&command.bus) {
            Some(bus_key) => bus_key,
            None => {
                log::warn!("Gravity comp stop command missing or invalid bus");
                return;
            }
        };

        log::info!("Stopping gravity compensation for bus: {:?}", bus_key);
        deactivate_gravity_comp(bus_key, modes, gravity_modes, gravity_settings, inference, normfs, rx_queue_id, Some(command));
    }

    /// Live-updates the gain of one arm joint on an already-running
    /// gravity-comp task (e.g. from a table cell in the UI), without
    /// restarting it. Always updates the staged settings (so the value is
    /// remembered/shown even if not currently running); only actually
    /// re-applies it to hardware if gravity comp is running on this bus.
    #[allow(clippy::too_many_arguments)]
    fn handle_set_gravity_comp_gain(
        command: mirroring::GravityCompCommand,
        modes: &ModesMap,
        gravity_modes: &GravityModesMap,
        gravity_settings: &GravitySettingsMap,
        inference: &Arc<Inference>,
        normfs: &Arc<NormFS>,
        rx_queue_id: &normfs::QueueId,
    ) {
        let bus_key = match decode_gravity_comp_bus(&command.bus) {
            Some(bus_key) => bus_key,
            None => {
                log::warn!("Gravity comp set-gain command missing or invalid bus");
                return;
            }
        };

        let motor_id = match command.motor_id {
            Some(id) if (1..=7).contains(&id) => id as u8,
            _ => {
                log::warn!("Gravity comp set-gain command for bus {:?} missing/invalid motor_id", bus_key);
                return;
            }
        };

        let gain = match command.gain_rad_per_nm {
            Some(gain) => gain,
            None => {
                log::warn!("Gravity comp set-gain command for bus {:?} missing gain value", bus_key);
                return;
            }
        };

        let clamped_gain = clamp_gravity_comp_gain(gain);
        {
            let mut settings = ensure_gravity_settings(gravity_settings, &bus_key, inference);
            settings.joint_gains[(motor_id - 1) as usize] = clamped_gain;
            gravity_settings.write().unwrap().insert(bus_key.clone(), settings);
        }

        let applied_live = inference.set_gravity_comp_gain(&bus_key, motor_id, gain);
        log::info!(
            "Gravity comp gain for bus {:?} motor {} set to {} (applied_live={})",
            bus_key,
            motor_id,
            clamped_gain,
            applied_live
        );

        // No mode transition here, but re-broadcast so the new gain shows up
        // in InferenceState.gravity_comp for any connected UI.
        let mut modes_guard = modes.write().unwrap();
        let mut gravity_guard = gravity_modes.write().unwrap();
        let gravity_settings_snapshot = gravity_settings.read().unwrap().clone();
        merge_modes(&mut modes_guard, &HashMap::new(), &mut gravity_guard, &HashMap::new(), &gravity_settings_snapshot, inference, normfs, rx_queue_id, None, Some(command));
    }

    /// Live-updates the torque limit (all 7 arm motors) for an already-running
    /// gravity-comp task, without restarting it. Same staged-vs-live handling
    /// as `handle_set_gravity_comp_gain` above.
    #[allow(clippy::too_many_arguments)]
    fn handle_set_gravity_comp_torque_limit(
        command: mirroring::GravityCompCommand,
        modes: &ModesMap,
        gravity_modes: &GravityModesMap,
        gravity_settings: &GravitySettingsMap,
        inference: &Arc<Inference>,
        normfs: &Arc<NormFS>,
        rx_queue_id: &normfs::QueueId,
    ) {
        let bus_key = match decode_gravity_comp_bus(&command.bus) {
            Some(bus_key) => bus_key,
            None => {
                log::warn!("Gravity comp set-torque-limit command missing or invalid bus");
                return;
            }
        };

        let torque_limit = match command.torque_limit {
            Some(t) => t as u16,
            None => {
                log::warn!("Gravity comp set-torque-limit command for bus {:?} missing torque_limit value", bus_key);
                return;
            }
        };

        let clamped = clamp_gravity_comp_torque_limit(torque_limit);
        {
            let mut settings = ensure_gravity_settings(gravity_settings, &bus_key, inference);
            settings.torque_limit = clamped;
            gravity_settings.write().unwrap().insert(bus_key.clone(), settings);
        }

        let applied_live = inference.set_gravity_comp_torque_limit(&bus_key, torque_limit);
        log::info!(
            "Gravity comp torque limit for bus {:?} set to {} (applied_live={})",
            bus_key,
            clamped,
            applied_live
        );

        let mut modes_guard = modes.write().unwrap();
        let mut gravity_guard = gravity_modes.write().unwrap();
        let gravity_settings_snapshot = gravity_settings.read().unwrap().clone();
        merge_modes(&mut modes_guard, &HashMap::new(), &mut gravity_guard, &HashMap::new(), &gravity_settings_snapshot, inference, normfs, rx_queue_id, None, Some(command));
    }

    /// Persists this bus's current staged gravity-comp settings (per-joint
    /// gains + torque limit) to the `motors_mirroring/gravity_comp_settings`
    /// queue, so they're restored as the defaults next time gravity comp is
    /// started on this bus - even across a station restart. No-op (logged)
    /// if there's nothing staged yet for this bus.
    fn handle_save_gravity_comp_settings(
        command: mirroring::GravityCompCommand,
        gravity_settings: &GravitySettingsMap,
        normfs: &Arc<NormFS>,
        gravity_settings_queue_id: &normfs::QueueId,
    ) {
        let bus_key = match decode_gravity_comp_bus(&command.bus) {
            Some(bus_key) => bus_key,
            None => {
                log::warn!("Gravity comp save-settings command missing or invalid bus");
                return;
            }
        };

        let settings = gravity_settings.read().unwrap().get(&bus_key).copied();
        let settings = match settings {
            Some(settings) => settings,
            None => {
                log::warn!("Gravity comp save-settings for bus {:?} ignored: nothing staged yet", bus_key);
                return;
            }
        };

        let envelope = mirroring::GravityCompSettingsEnvelope {
            monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
            local_stamp_ns: systime::get_local_stamp_ns(),
            app_start_id: systime::get_app_start_id(),
            bus: Some(mirroring::MirroringBus {
                unique_id: bus_key.bus_id.clone(),
                r#type: bus_key.bus_type as i32,
            }),
            joint_gains_rad_per_nm: settings.joint_gains.to_vec(),
            torque_limit: settings.torque_limit as u32,
        };

        let _ = normfs.enqueue(gravity_settings_queue_id, envelope.encode_to_vec().into());
        log::info!(
            "Saved gravity comp settings for bus {:?}: gains={:?}, torque_limit={}",
            bus_key,
            settings.joint_gains,
            settings.torque_limit
        );
    }

    /// Shared teardown path for both an operator-issued stop command and a
    /// control loop's own safety self-stop (stale data / sustained
    /// overcurrent) - both must converge on the same task-registry cleanup
    /// and mode broadcast so displayed state never drifts from what's
    /// actually running.
    #[allow(clippy::too_many_arguments)]
    fn deactivate_gravity_comp(
        bus_key: BusKey,
        modes: &ModesMap,
        gravity_modes: &GravityModesMap,
        gravity_settings: &GravitySettingsMap,
        inference: &Arc<Inference>,
        normfs: &Arc<NormFS>,
        rx_queue_id: &normfs::QueueId,
        command: Option<mirroring::GravityCompCommand>,
    ) {
        inference.stop_gravity_comp(bus_key.clone());

        let mut new_gravity = HashMap::new();
        new_gravity.insert(bus_key, mirroring::GravityCompState::GcDisabled);

        let mut modes_guard = modes.write().unwrap();
        let mut gravity_guard = gravity_modes.write().unwrap();
        let gravity_settings_snapshot = gravity_settings.read().unwrap().clone();
        merge_modes(&mut modes_guard, &HashMap::new(), &mut gravity_guard, &new_gravity, &gravity_settings_snapshot, inference, normfs, rx_queue_id, None, command);
    }
