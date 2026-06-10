use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use normfs::NormFS;
use station_iface::StationEngine;
use tokio::sync::mpsc;
use bytes::Bytes;
use normfs::UintN;
use prost::Message;
use memmap2::MmapMut;
use parking_lot::Mutex;

pub mod proto {
    pub mod normvla {
        include!("proto/normvla.rs");
    }
}

mod formats;

const INFERENCE_STATES_QUEUE: &str = "inference-states";

const BUFFER_COUNT: usize = 4;
const HEADER_SIZE: usize = 24;

#[repr(C)]
struct DataFrameHeader {
    sequence: u64,
    timestamp_ns: u64,
    data_size: u32,
    _padding: u32,
}

struct ShmWriter {
    mmap: Mutex<MmapMut>,
    write_idx: AtomicU64,
    buffer_size: usize,
    max_data_size: usize,
}

struct InferenceChannel {
    tx: mpsc::UnboundedSender<(UintN, station_iface::iface_proto::inference::InferenceRx)>,
    interval_ns: u64,
    last_timestamp_ns: AtomicU64,
}

impl ShmWriter {
    fn new(shm_path: &std::path::PathBuf, shm_size_mb: u64) -> Result<Self, normfs::Error> {
        let total_size = (shm_size_mb * 1024 * 1024) as usize;
        let buffer_size = total_size / BUFFER_COUNT;
        let max_data_size = buffer_size - HEADER_SIZE;

        let file = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .open(shm_path)
            .map_err(|e| normfs::Error::Io(e))?;

        file.set_len(total_size as u64)
            .map_err(|e| normfs::Error::Io(e))?;

        log::info!("Starting inference shared memory writer at {:?} ({}MB, {} buffers, {} bytes per buffer)",
            shm_path, shm_size_mb, BUFFER_COUNT, max_data_size);

        let mut mmap = unsafe { MmapMut::map_mut(&file).map_err(|e| normfs::Error::Io(e))? };

        // Initialize all buffer headers with MAX sequence
        for i in 0..BUFFER_COUNT {
            let offset = i * buffer_size;
            let buffer = &mut mmap[offset..offset + std::mem::size_of::<DataFrameHeader>()];
            let header = unsafe { &mut *(buffer.as_mut_ptr() as *mut DataFrameHeader) };
            header.sequence = u64::MAX;
        }

        Ok(Self {
            mmap: Mutex::new(mmap),
            write_idx: AtomicU64::new(0),
            buffer_size,
            max_data_size,
        })
    }

    pub fn write_bytes(&self, data: &Bytes, timestamp_ns: u64) {
        if data.len() > self.max_data_size {
            log::error!("Inference data too large to fit in shared memory buffer: {} bytes (max: {})",
                data.len(), self.max_data_size);
            return;
        }

        let write_idx = self.write_idx.fetch_add(1, Ordering::Relaxed);
        let buffer_idx = (write_idx % BUFFER_COUNT as u64) as usize;
        let offset = buffer_idx * self.buffer_size;

        let mut mmap = self.mmap.lock();

        // Write data
        let data_offset = offset + HEADER_SIZE;
        mmap[data_offset..data_offset + data.len()].copy_from_slice(data);

        // Update header
        let header_offset = offset;
        let header_slice = &mut mmap[header_offset..header_offset + std::mem::size_of::<DataFrameHeader>()];
        let header = unsafe { &mut *(header_slice.as_mut_ptr() as *mut DataFrameHeader) };

        header.data_size = data.len() as u32;
        header.timestamp_ns = timestamp_ns;

        std::sync::atomic::fence(std::sync::atomic::Ordering::Release);

        header.sequence = write_idx;
    }
}

pub async fn start<T: StationEngine>(
    normfs: Arc<NormFS>,
    station_engine: Arc<T>,
    inference_configs: Vec<station_iface::config::Inference>,
) -> Result<(), normfs::Error> {
    if inference_configs.is_empty() {
        log::info!("No inference configurations provided");
        return Ok(());
    }

    log::info!("Starting inference driver with {} configurations", inference_configs.len());

    // Create a channel for each inference config
    let mut channels = Vec::new();

    for config in &inference_configs {
        log::info!("Creating inference queue: {}", config.queue_id);
        let queue_id = normfs.resolve(&config.queue_id);
        normfs.ensure_queue_exists_for_write(&queue_id).await?;

        // Register queue with station engine
        station_engine.register_queue(
            &queue_id,
            station_iface::iface_proto::drivers::QueueDataType::QdtInferenceFrames,
            vec![],
        );

        // Create unbounded channel for this inference config
        let (tx, rx) = mpsc::unbounded_channel::<(UintN, station_iface::iface_proto::inference::InferenceRx)>();

        let channel = InferenceChannel {
            tx: tx.clone(),
            interval_ns: config.update_interval.as_nanos() as u64,
            last_timestamp_ns: AtomicU64::new(0),
        };
        channels.push(channel);

        // Create shared memory writer for this config if shm path is set
        let shm_writer = if !config.shm.as_os_str().is_empty() {
            Some(Arc::new(ShmWriter::new(&config.shm, config.shm_size_mb)?))
        } else {
            None
        };

        // Spawn processing coroutine for this config
        let normfs_clone = normfs.clone();
        let config_clone = config.clone();
        let shm_writer_clone = shm_writer.clone();

        tokio::spawn(async move {
            let mut rx = rx;
            log::info!("Inference processor started for queue: {}", config_clone.queue_id);
            while let Some((id, inference_rx)) = rx.recv().await {
                if let Err(e) = formats::process_inference_entry(
                    &normfs_clone,
                    &id,
                    &inference_rx,
                    &config_clone,
                    shm_writer_clone.as_ref().map(|w| w.as_ref()),
                ).await {
                    log::error!("Failed to process inference entry for queue {}: {}", config_clone.queue_id, e);
                }
            }
            log::warn!("Inference processor exited for queue: {} (channel closed)", config_clone.queue_id);
        });
    }

    let channels = Arc::new(channels);

    // Subscribe to inference-states queue
    let inference_states_queue_id = normfs.resolve(INFERENCE_STATES_QUEUE);
    normfs.subscribe(&inference_states_queue_id, Box::new(move |entries: &[(UintN, Bytes)]| {
        for (id, data) in entries {
            // Parse InferenceRx once
            let inference_rx = match station_iface::iface_proto::inference::InferenceRx::decode(data.as_ref()) {
                Ok(rx) => rx,
                Err(e) => {
                    log::error!("Failed to decode InferenceRx at id {}: {}", id, e);
                    continue;
                }
            };

            let timestamp_ns = inference_rx.monotonic_stamp_ns;

            // Check each channel's interval and send if elapsed
            for channel in channels.iter() {
                let last_ts = channel.last_timestamp_ns.load(Ordering::Relaxed);
                let elapsed = timestamp_ns.saturating_sub(last_ts);

                if elapsed >= channel.interval_ns {
                    if let Err(e) = channel.tx.send((id.clone(), inference_rx.clone())) {
                        log::error!("Failed to send to inference channel: {}", e);
                    }
                    channel.last_timestamp_ns.store(timestamp_ns, Ordering::Relaxed);
                }
            }
        }
        true
    }))?;

    log::info!("Inference driver started");

    Ok(())
}