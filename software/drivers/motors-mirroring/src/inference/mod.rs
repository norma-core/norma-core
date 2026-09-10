#![allow(clippy::collapsible_if)]
#![allow(clippy::needless_borrow)]

mod mirror;
mod model;
mod normalize;
use crate::proto::mirroring;
use crate::types::{Command, MotorCommand};
use crate::{
    config, proto::mirroring::inference_state::Bus, proto::mirroring::inference_state::Mirroring,
    types::BusKey,
};
use bytes::Bytes;
use normfs::NormFS;
use parking_lot::RwLock;
use prost::Message;
use station_iface::iface_proto::commands::{DriverCommand, StationCommandsPack};
use station_iface::{Backpressure, enqueue_with};
use std::sync::Arc;

/// Maximum acceptable data age before considering it stale (100ms in nanoseconds)
const MAX_DATA_AGE_NS: u64 = 100_000_000;

pub struct Inference {
    state: Arc<RwLock<model::State>>,
    normfs: Arc<NormFS>,
    commands_queue_id: normfs::QueueId,
}

impl Inference {
    pub async fn new(
        config: config::MotorConfig,
        normfs: Arc<NormFS>,
    ) -> Result<Self, normfs::Error> {
        let commands_queue_id = normfs.resolve("commands");
        normfs
            .ensure_queue_exists_for_write(&commands_queue_id)
            .await?;
        let res = Self {
            state: Arc::new(RwLock::new(model::State::default())),
            normfs,
            commands_queue_id: commands_queue_id.clone(),
        };

        let state = Arc::clone(&res.state);
        let normfs = Arc::clone(&res.normfs);
        tokio::spawn(async move {
            Self::mirror(state, &normfs, commands_queue_id, config).await;
        });

        Ok(res)
    }

    pub fn start(&self, from: BusKey, to: Vec<BusKey>) {
        let mut state = self.state.write();

        // For each new target, remove any existing mapping it's in.
        for target_key in &to {
            if let Some(old_from) = state.to_from.remove(target_key) {
                if let Some(old_from_targets) = state.from_to.get_mut(&old_from) {
                    old_from_targets.retain(|t| t != target_key);
                }
            }
        }

        // Add the new mappings.
        for target_key in &to {
            state.to_from.insert(target_key.clone(), from.clone());
        }

        let from_targets = state.from_to.entry(from).or_default();
        for target in &to {
            if !from_targets.contains(target) {
                from_targets.push(target.clone());
            }
        }

        // Enable torque on target motors
        let normfs = Arc::clone(&self.normfs);
        let commands_queue_id = self.commands_queue_id.clone();
        let targets_to_enable = to.clone();
        tokio::spawn(async move {
            let mut station_state = model::StationState::default();
            station_state.update_from_st3215_queue(&normfs).await;

            for target_key in targets_to_enable {
                if let Some(bus_state) = station_state.buses.get(&target_key) {
                    let mut commands = Vec::new();
                    for motor_id in bus_state.motors.keys() {
                        commands.push(Command {
                            target_bus_id: target_key.bus_id.clone(),
                            motor_id: *motor_id as u32,
                            command: MotorCommand::Torque(1),
                        });
                    }
                    Self::send_st3215_commands(
                        &normfs,
                        &commands_queue_id,
                        &Bytes::new(),
                        commands,
                        true,
                    )
                    .await;
                }
            }
        });
    }

    pub fn stop(&self, bus: BusKey) {
        let mut state = self.state.write();

        let mut buses_to_free = vec![bus.clone()];

        // If `bus` is a source, remove it and all its targets.
        if let Some(targets) = state.from_to.remove(&bus) {
            for target in targets {
                state.to_from.remove(&target);
                buses_to_free.push(target);
            }
        }

        // If `bus` is a target, remove it from its source's targets.
        if let Some(from_key) = state.to_from.remove(&bus) {
            if let Some(from_targets) = state.from_to.get_mut(&from_key) {
                from_targets.retain(|t| t != &bus);
                if from_targets.is_empty() {
                    state.from_to.remove(&from_key);
                }
            }
        }

        // Spawn async task to send torque=0 commands to free buses
        let normfs = Arc::clone(&self.normfs);
        let commands_queue_id = self.commands_queue_id.clone();
        tokio::spawn(async move {
            let mut station_state = model::StationState::default();
            station_state.update_from_st3215_queue(&normfs).await;

            for bus_to_free in buses_to_free {
                if let Some(bus_state) = station_state.buses.get(&bus_to_free) {
                    let mut commands = Vec::new();
                    for motor_id in bus_state.motors.keys() {
                        commands.push(Command {
                            target_bus_id: bus_to_free.bus_id.clone(),
                            motor_id: *motor_id as u32,
                            command: MotorCommand::Torque(0),
                        });
                    }
                    // Must not be dropped: the bus would stay torqued.
                    Self::send_st3215_commands(
                        &normfs,
                        &commands_queue_id,
                        &Bytes::new(),
                        commands,
                        true,
                    )
                    .await;
                }
            }
        });
    }

    pub fn get_mirrorings(&self) -> Vec<Mirroring> {
        let state = self.state.read();
        state
            .from_to
            .iter()
            .map(|(from, to_keys)| Mirroring {
                source: Some(Bus {
                    id: Some(mirroring::MirroringBus {
                        unique_id: from.bus_id.clone(),
                        r#type: from.bus_type as i32,
                    }),
                    mode: mirroring::BusMode::BrLeader as i32,
                }),
                targets: to_keys
                    .iter()
                    .map(|k| Bus {
                        id: Some(mirroring::MirroringBus {
                            unique_id: k.bus_id.clone(),
                            r#type: k.bus_type as i32,
                        }),
                        mode: mirroring::BusMode::BrFollower as i32,
                    })
                    .collect(),
            })
            .collect()
    }

    async fn mirror(
        state: Arc<RwLock<model::State>>,
        normfs: &Arc<NormFS>,
        commands_queue_id: normfs::QueueId,
        config: config::MotorConfig,
    ) {
        let mut station_state = model::StationState::default();
        let mut protection_states = std::collections::HashMap::new();

        let queue_id = normfs.resolve("st3215/inference");
        let (tx, rx) = tokio::sync::oneshot::channel();
        let tx = Arc::new(std::sync::Mutex::new(Some(tx)));
        let tx_clone = Arc::clone(&tx);

        normfs
            .subscribe(
                &queue_id,
                Box::new(move |entries| {
                    if !entries.is_empty() {
                        if let Ok(mut guard) = tx_clone.lock() {
                            if let Some(sender) = guard.take() {
                                let _ = sender.send(());
                            }
                        }
                        return false;
                    }
                    true
                }),
            )
            .ok();

        let _ = rx.await;

        let mut delays_us: std::collections::VecDeque<u64> = std::collections::VecDeque::new();
        let mut last_stats_print = std::time::Instant::now();
        // Match inference frame-stats cadence: 100 frames * 100ms/frame = 10s.
        let stats_interval = std::time::Duration::from_secs(10);

        let mut mirroring_states: std::collections::HashMap<BusKey, bool> =
            std::collections::HashMap::new();

        loop {
            let loop_start = std::time::Instant::now();
            station_state.update_from_st3215_queue(&normfs).await;

            let from_to = state.read().from_to.clone();

            // Get monotonic timestamp for staleness checking
            let now_ns = systime::get_monotonic_stamp_ns();

            for (source_bus_key, target_bus_keys) in &from_to {
                // Check if source has fresh data
                let source_fresh = station_state
                    .buses
                    .get(source_bus_key)
                    .map(|bus| {
                        bus.monotonic_stamp_ns > 0
                            && now_ns.saturating_sub(bus.monotonic_stamp_ns) < MAX_DATA_AGE_NS
                    })
                    .unwrap_or(false);

                // Check if ALL targets have fresh data
                let targets_fresh = target_bus_keys.iter().all(|target_key| {
                    station_state
                        .buses
                        .get(target_key)
                        .map(|bus| {
                            bus.monotonic_stamp_ns > 0
                                && now_ns.saturating_sub(bus.monotonic_stamp_ns) < MAX_DATA_AGE_NS
                        })
                        .unwrap_or(false)
                });

                let has_fresh_data = source_fresh && targets_fresh;
                let was_active = mirroring_states
                    .get(source_bus_key)
                    .copied()
                    .unwrap_or(true);

                // Log only on state transitions
                if !has_fresh_data && was_active {
                    log::warn!(
                        "Mirroring paused for source {}: stale data detected",
                        source_bus_key.bus_id
                    );
                    mirroring_states.insert(source_bus_key.clone(), false);
                } else if has_fresh_data && !was_active {
                    log::info!(
                        "Mirroring resumed for source {}: fresh data available",
                        source_bus_key.bus_id
                    );
                    mirroring_states.insert(source_bus_key.clone(), true);
                }

                // Skip processing if data is stale
                if !has_fresh_data {
                    continue;
                }

                Self::process_mirroring_for_source(
                    source_bus_key,
                    target_bus_keys,
                    &station_state,
                    &mut protection_states,
                    &commands_queue_id,
                    normfs,
                    &config,
                )
                .await;
            }

            let processing_done = std::time::Instant::now();

            // Calculate delay from source bus inference timestamp (if available, and only if fresh)
            if let Some(first_source) = from_to.keys().next() {
                if let Some(source_bus_state) = station_state.buses.get(first_source) {
                    if source_bus_state.monotonic_stamp_ns > 0 {
                        let delay_ns = now_ns.saturating_sub(source_bus_state.monotonic_stamp_ns);
                        // Only record delays for fresh data
                        if delay_ns < MAX_DATA_AGE_NS {
                            delays_us.push_back(delay_ns / 1000); // Convert to microseconds
                        }
                    }
                }
            }

            // Keep only recent samples (max 500 for 10 seconds at 20ms intervals)
            while delays_us.len() > 500 {
                delays_us.pop_front();
            }

            if processing_done - last_stats_print >= stats_interval {
                if !delays_us.is_empty() {
                    let avg_delay_us = delays_us.iter().sum::<u64>() / delays_us.len() as u64;
                    let min_delay_us = *delays_us.iter().min().unwrap();
                    let max_delay_us = *delays_us.iter().max().unwrap();
                    let frequency = delays_us.len() as f64 / stats_interval.as_secs_f64();

                    log::info!(
                        "Mirroring stats (last {}s): freq={:.1} Hz, delay avg={:.2}ms min={:.2}ms max={:.2}ms",
                        stats_interval.as_secs(),
                        frequency,
                        avg_delay_us as f64 / 1000.0,
                        min_delay_us as f64 / 1000.0,
                        max_delay_us as f64 / 1000.0,
                    );
                }
                last_stats_print = processing_done;
                delays_us.clear();
            }

            // Sleep for remaining time to maintain consistent loop rate
            let elapsed = processing_done - loop_start;
            if elapsed < config::MIRRORING_REFRESH_INTERVAL {
                tokio::time::sleep(config::MIRRORING_REFRESH_INTERVAL - elapsed).await;
            } else {
                // Processing took longer than interval - log warning and continue immediately
                log::warn!(
                    "Mirroring processing took {:.2}ms (exceeds {:.2}ms interval)",
                    elapsed.as_secs_f64() * 1000.0,
                    config::MIRRORING_REFRESH_INTERVAL.as_secs_f64() * 1000.0
                );
            }
        }
    }

    async fn process_mirroring_for_source(
        source_bus_key: &BusKey,
        target_bus_keys: &[BusKey],
        station_state: &model::StationState,
        protection_states: &mut std::collections::HashMap<
            model::ProtectionKey,
            model::MotorProtectionState,
        >,
        commands_queue_id: &normfs::QueueId,
        normfs: &Arc<NormFS>,
        config: &config::MotorConfig,
    ) {
        if let Some(source_bus_state) = station_state.buses.get(source_bus_key) {
            let mut commands = Vec::new();
            for (source_motor_id, source_motor_state) in &source_bus_state.motors {
                Self::process_motor_mirroring(
                    source_motor_id,
                    source_motor_state,
                    target_bus_keys,
                    station_state,
                    protection_states,
                    config,
                    &mut commands,
                );
            }
            if !commands.is_empty() {
                Self::send_st3215_commands(
                    normfs,
                    commands_queue_id,
                    &station_state.id,
                    commands,
                    false,
                )
                .await;
            }
        }
    }

    fn process_motor_mirroring(
        source_motor_id: &u8,
        source_motor_state: &model::MotorState,
        target_bus_keys: &[BusKey],
        station_state: &model::StationState,
        protection_states: &mut std::collections::HashMap<
            model::ProtectionKey,
            model::MotorProtectionState,
        >,
        config: &config::MotorConfig,
        commands: &mut Vec<Command>,
    ) {
        for target_bus_key in target_bus_keys {
            if let Some(target_bus_state) = station_state.buses.get(target_bus_key) {
                if let Some(target_motor_state) = target_bus_state.motors.get(source_motor_id) {
                    mirror::get_movement_sequence_with_goal(
                        &target_bus_key.bus_id,
                        *source_motor_id as u16,
                        source_motor_state,
                        target_motor_state,
                        config,
                        protection_states,
                        commands,
                    );
                }
            }
        }
    }

    fn add_sync_write_to_pack(
        pack: &mut StationCommandsPack,
        bus_id: String,
        address: u32,
        motors: Vec<(u32, Bytes)>,
    ) {
        // Skip if no motors to write
        if motors.is_empty() {
            return;
        }

        let driver_cmd = st3215::st3215_proto::Command {
            target_bus_serial: bus_id.clone(),
            sync_write: Some(st3215::st3215_proto::St3215SyncWriteCommand {
                address,
                motors: motors
                    .into_iter()
                    .map(|(motor_id, value)| {
                        st3215::st3215_proto::st3215_sync_write_command::MotorWrite {
                            motor_id,
                            value,
                        }
                    })
                    .collect(),
            }),
            ..Default::default()
        };

        let cmd_bytes = Bytes::from(driver_cmd.encode_to_vec());
        let cmd_id = Bytes::from(bus_id.into_bytes());

        pack.commands.push(DriverCommand {
            command_id: cmd_id,
            r#type: station_iface::iface_proto::drivers::StationCommandType::StcSt3215Command
                as i32,
            body: cmd_bytes,
        });
    }

    async fn send_st3215_commands(
        normfs: &NormFS,
        commands_queue_id: &normfs::QueueId,
        state_id: &Bytes,
        commands: Vec<Command>,
        keep: bool,
    ) {
        use std::collections::HashMap;

        let mut pack = StationCommandsPack {
            inference_state_id: state_id.clone(),
            tags: vec!["mirroring".to_string()],
            ..Default::default()
        };

        // Group commands by (bus_id, address) for SyncWrite batching
        let mut torque_cmds: HashMap<String, Vec<(u32, Bytes)>> = HashMap::new();
        let mut speed_cmds: HashMap<String, Vec<(u32, Bytes)>> = HashMap::new();
        let mut accel_cmds: HashMap<String, Vec<(u32, Bytes)>> = HashMap::new();
        let mut goal_cmds: HashMap<String, Vec<(u32, Bytes)>> = HashMap::new();

        for cmd in &commands {
            match cmd.command {
                MotorCommand::Torque(torque) => {
                    torque_cmds
                        .entry(cmd.target_bus_id.clone())
                        .or_default()
                        .push((cmd.motor_id, Bytes::from(vec![torque])));
                }
                MotorCommand::Speed(speed) => {
                    speed_cmds
                        .entry(cmd.target_bus_id.clone())
                        .or_default()
                        .push((cmd.motor_id, Bytes::from(speed.to_le_bytes().to_vec())));
                }
                MotorCommand::Accel(accel) => {
                    accel_cmds
                        .entry(cmd.target_bus_id.clone())
                        .or_default()
                        .push((cmd.motor_id, Bytes::from(vec![accel as u8])));
                }
                MotorCommand::Goal(pos) => {
                    goal_cmds
                        .entry(cmd.target_bus_id.clone())
                        .or_default()
                        .push((cmd.motor_id, Bytes::from(pos.to_le_bytes().to_vec())));
                }
            }
        }

        // Maintain order: torque → speed/accel → goal
        // 1. Torque enable
        for (bus_id, motors) in torque_cmds {
            Self::add_sync_write_to_pack(
                &mut pack,
                bus_id,
                st3215::protocol::RamRegister::TorqueEnable.address() as u32,
                motors,
            );
        }

        // 2. Speed
        for (bus_id, motors) in speed_cmds {
            Self::add_sync_write_to_pack(
                &mut pack,
                bus_id,
                st3215::protocol::RamRegister::GoalSpeed.address() as u32,
                motors,
            );
        }

        // 3. Acceleration
        for (bus_id, motors) in accel_cmds {
            Self::add_sync_write_to_pack(
                &mut pack,
                bus_id,
                st3215::protocol::RamRegister::Acc.address() as u32,
                motors,
            );
        }

        // 4. Goal position (triggers movement)
        for (bus_id, motors) in goal_cmds {
            Self::add_sync_write_to_pack(
                &mut pack,
                bus_id,
                st3215::protocol::RamRegister::GoalPosition.address() as u32,
                motors,
            );
        }

        let data = Bytes::from(pack.encode_to_vec());
        let policy = if keep {
            Backpressure::Keep
        } else {
            Backpressure::Skip
        };
        if let Err(e) = enqueue_with(normfs, commands_queue_id, data, policy).await {
            log::error!("Failed to publish mirroring commands: {e}");
        }
    }
}
