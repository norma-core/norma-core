use crate::kernel_log_proto::{KernelLogSignalType, KernelMessage, RxEnvelope};
use crate::matcher::classify;
use crate::parser::parse_record;
use crate::reader::{KMSG_PATH, KmsgSource, RECORD_BUFFER_SIZE, ReadOutcome, SUPPORTED};
use bytes::Bytes;
use log::{error, info};
use normfs::{NormFS, QueueId};
use prost::Message;
use station_iface::StationEngine;
use station_iface::iface_proto::drivers::QueueDataType;
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

pub const QUEUE_ID: &str = "kernel/rx";

const POLL_INTERVAL: Duration = Duration::from_millis(200);
const RETRY_INTERVAL: Duration = Duration::from_secs(60);
const MAX_MESSAGES_PER_ENVELOPE: usize = 512;
const MAX_MESSAGES_PER_SECOND: u32 = 200;

pub struct KernelLogDriver {
    _worker: JoinHandle<()>,
}

impl KernelLogDriver {
    pub async fn new<T: StationEngine>(
        normfs: Arc<NormFS>,
        station_engine: Arc<T>,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let queue_id = normfs.resolve(QUEUE_ID);
        normfs.ensure_queue_exists_for_write(&queue_id).await?;
        station_engine.register_queue(&queue_id, QueueDataType::QdtKernelLogRx, vec![]);

        if SUPPORTED {
            info!("kernel-log watching {}", KMSG_PATH);
        }

        let publisher = Publisher { normfs, queue_id };
        let worker = thread::Builder::new()
            .name("kernel-log".to_string())
            .spawn(move || run(publisher))?;

        Ok(Self { _worker: worker })
    }
}

pub async fn start_kernel_log_driver<T: StationEngine>(
    normfs: Arc<NormFS>,
    station_engine: Arc<T>,
) -> Result<Arc<KernelLogDriver>, Box<dyn std::error::Error>> {
    let driver = KernelLogDriver::new(normfs, station_engine).await?;
    Ok(Arc::new(driver))
}

struct Publisher {
    normfs: Arc<NormFS>,
    queue_id: QueueId,
}

impl Publisher {
    fn publish(&self, envelope: RxEnvelope) {
        let mut buffer = Vec::with_capacity(envelope.encoded_len());

        if let Err(err) = envelope.encode(&mut buffer) {
            error!("Failed to encode kernel log envelope: {}", err);
            return;
        }

        if let Err(err) = self.normfs.enqueue(&self.queue_id, Bytes::from(buffer)) {
            error!("Failed to enqueue kernel log envelope: {}", err);
        }
    }

    fn publish_signal(&self, signal_type: KernelLogSignalType) {
        self.publish(new_envelope(signal_type));
    }

    fn publish_error(&self, signal_type: KernelLogSignalType, error: String) {
        let mut envelope = new_envelope(signal_type);
        envelope.error = error;
        self.publish(envelope);
    }

    fn publish_messages(&self, messages: Vec<KernelMessage>, dropped: u64) {
        let mut envelope = new_envelope(KernelLogSignalType::KernelLogMessages);
        envelope.messages = messages;
        envelope.dropped_messages = dropped;
        self.publish(envelope);
    }

    fn publish_gap(&self, from_seq: u64, to_seq: u64) {
        let mut envelope = new_envelope(KernelLogSignalType::KernelLogGap);
        envelope.gap_from_seq = from_seq;
        envelope.gap_to_seq = to_seq;
        envelope.dropped_messages = to_seq.saturating_sub(from_seq).saturating_add(1);
        self.publish(envelope);
    }
}

fn new_envelope(signal_type: KernelLogSignalType) -> RxEnvelope {
    RxEnvelope {
        monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
        local_stamp_ns: systime::get_local_stamp_ns(),
        app_start_id: systime::get_app_start_id(),
        signal_type: signal_type as i32,
        ..Default::default()
    }
}

fn run(publisher: Publisher) {
    publisher.publish_signal(KernelLogSignalType::KernelLogStarted);

    if !SUPPORTED {
        info!("kernel-log is not available on {}", std::env::consts::OS);
        publisher.publish_error(
            KernelLogSignalType::KernelLogSourceUnavailable,
            format!(
                "kernel log watching is not available on {}",
                std::env::consts::OS
            ),
        );
        return;
    }

    let mut replay_backlog = true;
    let mut unavailable_reported = false;

    loop {
        match KmsgSource::open(replay_backlog) {
            Ok(source) => {
                unavailable_reported = false;
                follow(source, &publisher, replay_backlog);
                replay_backlog = false;
            }
            Err(err) => {
                if !unavailable_reported {
                    error!("kernel-log cannot read {}: {}", KMSG_PATH, err);
                    publisher.publish_error(
                        KernelLogSignalType::KernelLogSourceUnavailable,
                        err.to_string(),
                    );
                    unavailable_reported = true;
                }
            }
        }

        thread::sleep(RETRY_INTERVAL);
    }
}

fn follow(mut source: KmsgSource, publisher: &Publisher, replay_backlog: bool) {
    let mut buffer = vec![0u8; RECORD_BUFFER_SIZE];
    let mut batch: Vec<KernelMessage> = Vec::new();
    let mut dropped: u64 = 0;
    let mut backlog = replay_backlog;
    let mut last_seq: Option<u64> = None;
    let mut limiter = RateLimiter::new(MAX_MESSAGES_PER_SECOND);

    loop {
        match source.read_record(&mut buffer) {
            ReadOutcome::Record(size) => {
                let Some(record) = parse_record(&buffer[..size]) else {
                    continue;
                };

                if let Some(previous) = last_seq
                    && record.seq > previous + 1
                {
                    flush(publisher, &mut batch, &mut dropped);
                    publisher.publish_gap(previous + 1, record.seq - 1);
                }
                last_seq = Some(record.seq);

                if !backlog && !limiter.allow() {
                    dropped += 1;
                    continue;
                }

                batch.push(KernelMessage {
                    seq: record.seq,
                    priority: record.priority as u32,
                    facility: record.facility as u32,
                    kernel_monotonic_us: record.monotonic_us,
                    from_backlog: backlog,
                    category: classify(&record) as i32,
                    message: record.message,
                    subsystem: record.subsystem,
                    device: record.device,
                });

                if batch.len() >= MAX_MESSAGES_PER_ENVELOPE {
                    flush(publisher, &mut batch, &mut dropped);
                }
            }
            ReadOutcome::Drained => {
                flush(publisher, &mut batch, &mut dropped);

                if backlog {
                    backlog = false;
                    publisher.publish_signal(KernelLogSignalType::KernelLogBacklogComplete);
                }

                thread::sleep(POLL_INTERVAL);
            }
            ReadOutcome::Overrun => {
                flush(publisher, &mut batch, &mut dropped);
            }
            ReadOutcome::Oversized => {
                dropped += 1;
            }
            ReadOutcome::Failed(err) => {
                flush(publisher, &mut batch, &mut dropped);
                error!("kernel-log read failed: {}", err);
                publisher.publish_error(KernelLogSignalType::KernelLogError, err.to_string());
                return;
            }
        }
    }
}

fn flush(publisher: &Publisher, batch: &mut Vec<KernelMessage>, dropped: &mut u64) {
    if batch.is_empty() && *dropped == 0 {
        return;
    }

    publisher.publish_messages(std::mem::take(batch), std::mem::take(dropped));
}

struct RateLimiter {
    limit: u32,
    window_start: Instant,
    count: u32,
}

impl RateLimiter {
    fn new(limit: u32) -> Self {
        Self {
            limit,
            window_start: Instant::now(),
            count: 0,
        }
    }

    fn allow(&mut self) -> bool {
        let now = Instant::now();
        if now.duration_since(self.window_start) >= Duration::from_secs(1) {
            self.window_start = now;
            self.count = 0;
        }

        if self.count >= self.limit {
            return false;
        }

        self.count += 1;
        true
    }
}
