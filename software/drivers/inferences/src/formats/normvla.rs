use std::sync::Arc;
use std::sync::Mutex;
use normfs::NormFS;
use normfs::UintN;
use prost::Message;
use bytes::Bytes;
use st3215::protocol::{get_motor_position, get_motor_goal_position, get_motor_current, get_motor_velocity, normalize_motor_position, is_motor_error, is_torque_enabled, RamRegister, ServoError};
use crate::proto::normvla;

// Skip frame if timestamp diff > 100ms
const MAX_STAMP_DIFF_NS: u64 = 100_000_000; // 100ms

// Statistics tracking for frame skips
#[derive(Default, Debug)]
struct FrameSkipStats {
    total_frames: u64,
    skipped_bus_ahead: u64,
    skipped_bus_large_diff: u64,
    skipped_motor_error: u64,
    skipped_video_ahead: u64,
    skipped_video_large_diff: u64,
    skipped_no_images: u64,
    skipped_no_torque: u64,
    skipped_invalid_range: u64,
    skipped_no_bus: u64,
    processed_frames: u64,
    max_bus_diff_ms: u64,
    max_video_diff_ms: u64,
}

lazy_static::lazy_static! {
    static ref FRAME_STATS: Mutex<FrameSkipStats> = Mutex::new(FrameSkipStats::default());
}

// Latched at the first `no_bus` skip so we don't spam the log every frame.
// Cleared once the bus is resolved again — so a subsequent disappearance warns fresh.
static NO_BUS_WARNED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

impl FrameSkipStats {
    fn reset(&mut self) {
        *self = FrameSkipStats::default();
    }

    fn log_and_reset(&mut self) {
        if self.total_frames == 0 {
            return;
        }

        let skip_rate = ((self.total_frames - self.processed_frames) as f64 / self.total_frames as f64) * 100.0;

        log::info!(
            "Frame stats (last {} frames): processed={}, skipped={} ({:.1}%), reasons: bus_ahead={}, bus_diff={}, motor_error={}, video_ahead={}, video_diff={}, no_images={}, no_torque={}, invalid_range={}, no_bus={}; max_diffs: bus={}ms, video={}ms",
            self.total_frames,
            self.processed_frames,
            self.total_frames - self.processed_frames,
            skip_rate,
            self.skipped_bus_ahead,
            self.skipped_bus_large_diff,
            self.skipped_motor_error,
            self.skipped_video_ahead,
            self.skipped_video_large_diff,
            self.skipped_no_images,
            self.skipped_no_torque,
            self.skipped_invalid_range,
            self.skipped_no_bus,
            self.max_bus_diff_ms,
            self.max_video_diff_ms,
        );

        self.reset();
    }
}

pub async fn generate_frame(
    normfs: &Arc<NormFS>,
    id: &UintN,
    inference_rx: &station_iface::iface_proto::inference::InferenceRx,
    config: &station_iface::config::Inference,
    shm_writer: Option<&crate::ShmWriter>,
) -> Result<(), Box<dyn std::error::Error>> {
    let output_queue_id = normfs.resolve(&config.queue_id);

    // Update frame counter and log stats every 100 frames
    {
        let mut stats = FRAME_STATS.lock().unwrap();
        stats.total_frames += 1;
        if stats.total_frames.is_multiple_of(100) {
            stats.log_and_reset();
        }
    }

    let mut joints = Vec::new();
    let mut images = Vec::new();

    // Sort entries: process ST3215 entries before usbvideo (faster)
    let mut sorted_entries: Vec<_> = inference_rx.entries.iter().collect();
    sorted_entries.sort_by_key(|entry| {
        match station_iface::iface_proto::drivers::QueueDataType::try_from(entry.r#type) {
            Ok(station_iface::iface_proto::drivers::QueueDataType::QdtSt3215Inference) => 0,
            Ok(station_iface::iface_proto::drivers::QueueDataType::QdtUsbVideoFrames) => 1,
            _ => 2,
        }
    });

    // Process each entry in the InferenceRx
    for entry in sorted_entries {
        // Filter: only process types we care about
        let entry_type = match station_iface::iface_proto::drivers::QueueDataType::try_from(entry.r#type) {
            Ok(t) => t,
            Err(_) => {
                log::debug!("Unknown entry type: {}", entry.r#type);
                continue;
            }
        };

        // Only process ST3215 inference and USB video frames
        match entry_type {
            station_iface::iface_proto::drivers::QueueDataType::QdtSt3215Inference |
            station_iface::iface_proto::drivers::QueueDataType::QdtUsbVideoFrames => {}
            _ => {
                // Skip all other types
                continue;
            }
        }

        // Parse the pointer from the entry
        let ptr = match normfs::UintN::read_value_from_slice(&entry.ptr, entry.ptr.len()) {
            Ok(p) => p,
            Err(e) => {
                log::error!("Failed to parse ptr for queue {}: {}", entry.queue, e);
                continue;
            }
        };

        // Read the actual frame data from the queue at this pointer
        let (tx, mut rx) = tokio::sync::mpsc::channel(1);
        let entry_queue_id = normfs.resolve(&entry.queue);
        if let Err(e) = normfs.read(&entry_queue_id, normfs::ReadPosition::Absolute(ptr.clone()), 1, 1, tx).await {
            log::error!("Failed to read from queue {} at ptr {}: {}", entry.queue, ptr, e);
            continue;
        }

        // Get the frame data
        let frame_data = match rx.recv().await {
            Some(read_entry) => read_entry.data,
            None => {
                log::warn!("No data received from queue {} at ptr {}", entry.queue, ptr);
                continue;
            }
        };

        match entry_type {
            station_iface::iface_proto::drivers::QueueDataType::QdtSt3215Inference => {
                // Parse ST3215 inference state
                if let Ok(inference_state) = st3215::st3215_proto::InferenceState::decode(frame_data.as_ref()) {
                    match parse_joints(&inference_state, &config.st3215_bus, inference_rx.monotonic_stamp_ns) {
                        Some(parsed_joints) => joints.extend(parsed_joints),
                        None => return Ok(()),
                    }
                }
            }
            station_iface::iface_proto::drivers::QueueDataType::QdtUsbVideoFrames => {
                // Parse USB video frames
                if let Ok(rx_envelope) = usbvideo::usbvideo_proto::usbvideo::RxEnvelope::decode(frame_data.as_ref()) {
                    if let Some(parsed_images) = parse_usb_video_frames(&rx_envelope, inference_rx.monotonic_stamp_ns) {
                        images.extend(parsed_images);
                    } else {
                        return Ok(());
                    }
                }
            }
            _ => {
                // Skip unknown queue types
            }
        }
    }

    // Skip frame if no images (cannot infer without images)
    if images.is_empty() {
        log::info!(
            "Skip: no_images (inference_stamp_ns={}, entries={}, joints={})",
            inference_rx.monotonic_stamp_ns,
            inference_rx.entries.len(),
            joints.len()
        );
        FRAME_STATS.lock().unwrap().skipped_no_images += 1;
        return Ok(());
    }

    // Create normvla Frame
    let frame = normvla::Frame {
        global_frame_id: id.value_to_bytes(),
        monotonic_stamp_ns: inference_rx.monotonic_stamp_ns,
        joints,
        images,
    };

    let encoded_frame = Bytes::from(frame.encode_to_vec());

    if let Err(e) = normfs.try_enqueue(&output_queue_id, encoded_frame.clone())
        && !matches!(e, normfs::Error::WouldBlock)
    {
        log::error!("Failed to enqueue normvla frame to {output_queue_id}: {e}");
    }

    // Write to shared memory if writer is provided
    if let Some(writer) = shm_writer {
        writer.write_bytes(&encoded_frame, inference_rx.monotonic_stamp_ns);
    }

    // Increment processed frames counter
    FRAME_STATS.lock().unwrap().processed_frames += 1;

    Ok(())
}

/// Check if a bus has at least one motor with torque enabled
fn bus_has_torque_enabled(bus: &st3215::st3215_proto::inference_state::BusState) -> bool {
    for motor in &bus.motors {
        if is_torque_enabled(&motor.state) {
            return true;
        }
    }
    false
}

/// Find the single bus with torque enabled for "auto" mode
/// Returns None if zero or multiple buses have torque enabled
fn find_single_torque_enabled_bus(
    inference_state: &st3215::st3215_proto::InferenceState,
) -> Option<String> {
    let mut buses_with_torque = Vec::new();

    for bus in &inference_state.buses {
        if bus_has_torque_enabled(bus)
            && let Some(b) = &bus.bus
        {
            buses_with_torque.push(b.serial_number.clone());
        }
    }

    match buses_with_torque.len() {
        1 => Some(buses_with_torque[0].clone()),
        0 => {
            // No buses with torque - skip frame
            None
        }
        _ => {
            // Multiple buses with torque - ambiguous, skip frame
            None
        }
    }
}

fn parse_joints(
    inference_state: &st3215::st3215_proto::InferenceState,
    target_bus: &str,
    inference_stamp_ns: u64,
) -> Option<Vec<normvla::Joint>> {
    let mut joints = Vec::new();
    let mut any_torque_enabled = false;

    // Handle "auto" mode: find single bus with torque enabled
    let resolved_bus = if target_bus == "auto" {
        match find_single_torque_enabled_bus(inference_state) {
            Some(bus) => bus,
            None => {
                if !NO_BUS_WARNED.swap(true, std::sync::atomic::Ordering::Relaxed) {
                    let bus_list: Vec<_> = inference_state.buses.iter().map(|b| {
                        let serial = b.bus.as_ref().map(|x| x.serial_number.as_str()).unwrap_or("");
                        let torque = bus_has_torque_enabled(b);
                        format!("{}(torque={})", serial, torque)
                    }).collect();
                    log::warn!(
                        "Skip: no_bus (auto mode — zero or multiple buses with torque: [{}])",
                        bus_list.join(", ")
                    );
                }
                FRAME_STATS.lock().unwrap().skipped_no_bus += 1;
                return None;
            }
        }
    } else {
        target_bus.to_string()
    };

    for bus in &inference_state.buses {
        let bus_serial = bus.bus.as_ref().map(|b| b.serial_number.as_str()).unwrap_or("");

        // Only process the configured bus
        if bus_serial != resolved_bus {
            continue;
        }

        // Check bus timestamp synchronization
        // Bus timestamp must be <= inference timestamp (cannot be in the future)
        if bus.monotonic_stamp_ns > inference_stamp_ns {
            log::info!(
                "Skip: bus_ahead (bus={} bus_stamp_ns={} inference_stamp_ns={} ahead_by_ms={})",
                bus_serial,
                bus.monotonic_stamp_ns,
                inference_stamp_ns,
                (bus.monotonic_stamp_ns - inference_stamp_ns) / 1_000_000
            );
            FRAME_STATS.lock().unwrap().skipped_bus_ahead += 1;
            return None;
        }

        let bus_stamp_diff = inference_stamp_ns - bus.monotonic_stamp_ns;
        let bus_stamp_diff_ms = bus_stamp_diff / 1_000_000;

        // Track max diff
        {
            let mut stats = FRAME_STATS.lock().unwrap();
            if bus_stamp_diff_ms > stats.max_bus_diff_ms {
                stats.max_bus_diff_ms = bus_stamp_diff_ms;
            }
        }

        if bus_stamp_diff > MAX_STAMP_DIFF_NS {
            log::info!(
                "Skip: bus_diff (bus={} diff_ms={} limit_ms={} bus_stamp_ns={} inference_stamp_ns={})",
                bus_serial,
                bus_stamp_diff_ms,
                MAX_STAMP_DIFF_NS / 1_000_000,
                bus.monotonic_stamp_ns,
                inference_stamp_ns
            );
            FRAME_STATS.lock().unwrap().skipped_bus_large_diff += 1;
            return None;
        }

        // Sort motors by ID
        let mut motors: Vec<_> = bus.motors.iter().collect();
        motors.sort_by_key(|m| m.id);

        for motor in motors {
            let state_bytes = &motor.state;

            // Check for invalid range
            if motor.range_min == motor.range_max {
                log::info!(
                    "Skip: invalid_range (bus={} motor={} range_min={} range_max={})",
                    bus_serial, motor.id, motor.range_min, motor.range_max
                );
                FRAME_STATS.lock().unwrap().skipped_invalid_range += 1;
                return None;
            }

            // Check for motor error
            if is_motor_error(state_bytes) {
                let status_addr = RamRegister::Status.address() as usize;
                let status = state_bytes.get(status_addr).copied().unwrap_or(0);
                let errors = ServoError::from_bits(status);
                log::info!(
                    "Skip: motor_error (bus={} motor={} status=0x{:02X} {:?})",
                    bus_serial, motor.id, status, errors
                );
                FRAME_STATS.lock().unwrap().skipped_motor_error += 1;
                return None;
            }

            let position = get_motor_position(state_bytes);

            // If torque is disabled, goal = present position
            let torque_enabled = is_torque_enabled(state_bytes);
            let goal = if torque_enabled {
                any_torque_enabled = true;
                get_motor_goal_position(state_bytes)
            } else {
                position
            };

            let current = get_motor_current(state_bytes);
            let velocity = get_motor_velocity(state_bytes);

            let position_norm = normalize_motor_position(position, motor.range_min as u16, motor.range_max as u16);
            let goal_norm = normalize_motor_position(goal, motor.range_min as u16, motor.range_max as u16);

            joints.push(normvla::Joint {
                range_min: motor.range_min,
                range_max: motor.range_max,
                position: position as u32,
                position_norm,
                goal: goal as u32,
                goal_norm,
                current_ma: current as u32,
                velocity: velocity as u32,
                monotonic_stamp_ns: motor.monotonic_stamp_ns,
            });
        }
    }

    // Skip frame if no joints were found (target bus not present)
    if joints.is_empty() {
        if !NO_BUS_WARNED.swap(true, std::sync::atomic::Ordering::Relaxed) {
            let available: Vec<_> = inference_state.buses.iter()
                .filter_map(|b| b.bus.as_ref().map(|x| x.serial_number.clone()))
                .collect();
            log::warn!(
                "Skip: no_bus (resolved_bus={} target_bus={} available=[{}])",
                resolved_bus, target_bus, available.join(", ")
            );
        }
        FRAME_STATS.lock().unwrap().skipped_no_bus += 1;
        return None;
    }

    // Bus resolved and produced joints — clear the latch so future disappearances warn afresh.
    NO_BUS_WARNED.store(false, std::sync::atomic::Ordering::Relaxed);

    // Skip frame if no motors have torque enabled
    if !any_torque_enabled {
        FRAME_STATS.lock().unwrap().skipped_no_torque += 1;
        return None;
    }

    Some(joints)
}

fn parse_usb_video_frames(
    rx_envelope: &usbvideo::usbvideo_proto::usbvideo::RxEnvelope,
    inference_stamp_ns: u64,
) -> Option<Vec<normvla::Image>> {
    let frames_pack = rx_envelope.frames.as_ref()?;

    // Check if we have frame data
    if frames_pack.frames_data.is_empty() {
        log::debug!("USB video RxEnvelope has no frame data");
        return None;
    }

    // Check if we have stamps
    if frames_pack.stamps.is_empty() {
        log::warn!("USB video RxEnvelope has frames but no stamps");
        return None;
    }

    // Get the last (latest) frame
    let frame_data = frames_pack.frames_data.last()?;
    if frame_data.is_empty() {
        log::debug!("USB video frame data is empty");
        return None;
    }

    let stamp = frames_pack.stamps.last()?;
    let frame_stamp_ns = stamp.monotonic_stamp_ns;

    // Frame timestamp must not be ahead of inference timestamp
    if frame_stamp_ns > inference_stamp_ns {
        log::info!(
            "Skip: video_ahead (frame_stamp_ns={} inference_stamp_ns={} ahead_by_ms={})",
            frame_stamp_ns, inference_stamp_ns,
            (frame_stamp_ns - inference_stamp_ns) / 1_000_000
        );
        FRAME_STATS.lock().unwrap().skipped_video_ahead += 1;
        return None;
    }

    // Check timestamp synchronization
    let stamp_diff = inference_stamp_ns - frame_stamp_ns;
    let stamp_diff_ms = stamp_diff / 1_000_000;

    // Track max diff
    {
        let mut stats = FRAME_STATS.lock().unwrap();
        if stamp_diff_ms > stats.max_video_diff_ms {
            stats.max_video_diff_ms = stamp_diff_ms;
        }
    }

    if stamp_diff > MAX_STAMP_DIFF_NS {
        log::info!(
            "Skip: video_diff (diff_ms={} limit_ms={} frame_stamp_ns={} inference_stamp_ns={})",
            stamp_diff_ms, MAX_STAMP_DIFF_NS / 1_000_000,
            frame_stamp_ns, inference_stamp_ns
        );
        FRAME_STATS.lock().unwrap().skipped_video_large_diff += 1;
        return None;
    }

    // Check frame dimensions and resize if needed
    let format = frames_pack.format.as_ref()?;
    let jpeg = if format.width == 224 && format.height == 224 {
        // Already 224x224, use as-is
        frame_data.clone()
    } else {
        // Need to resize to 224x224
        resize_jpeg_to_224x224(frame_data, format.width, format.height)?
    };

    Some(vec![normvla::Image {
        jpeg,
        monotonic_stamp_ns: frame_stamp_ns,
    }])
}

fn resize_jpeg_to_224x224(jpeg_data: &[u8], src_width: u32, src_height: u32) -> Option<Bytes> {
    // Decode JPEG to RGB
    let rgb_data = match usbvideo::convert_mjpeg_to_rgb(src_width as u16, src_height as u16, &Bytes::copy_from_slice(jpeg_data)) {
        Ok(data) => Bytes::from(data),
        Err(e) => {
            log::error!("Failed to decode JPEG for resizing: {}", e);
            return None;
        }
    };

    // Resize RGB to 224x224
    let resized_rgb = usbvideo::resize_rgb_bilinear(
        &rgb_data,
        src_width,
        src_height,
        224,
        224,
    );

    // Re-encode to JPEG
    match usbvideo::convert_rgb_to_jpeg(224, 224, resized_rgb, 90) {
        Ok(jpeg) => Some(jpeg),
        Err(e) => {
            log::error!("Failed to encode resized image to JPEG: {}", e);
            None
        }
    }
}
