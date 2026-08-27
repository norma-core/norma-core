use crate::dmesg_proto::{DmesgSignalType, RxEnvelope};
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

pub const QUEUE_ID: &str = "dmesg/rx";

const POLL_INTERVAL: Duration = Duration::from_millis(200);
const RETRY_INTERVAL: Duration = Duration::from_secs(60);
const MAX_RECORDS_PER_ENVELOPE: usize = 512;
const MAX_RECORDS_PER_SECOND: u32 = 200;

pub struct DmesgDriver {
    _worker: JoinHandle<()>,
}

impl DmesgDriver {
    pub async fn new<T: StationEngine>(
        normfs: Arc<NormFS>,
        station_engine: Arc<T>,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let queue_id = normfs.resolve(QUEUE_ID);
        normfs.ensure_queue_exists_for_write(&queue_id).await?;
        station_engine.register_queue(&queue_id, QueueDataType::QdtDmesgRx, vec![]);

        if SUPPORTED {
            info!("dmesg watching {}", KMSG_PATH);
        }

        let publisher = Publisher { normfs, queue_id };
        let worker = thread::Builder::new()
            .name("dmesg".to_string())
            .spawn(move || run(publisher))?;

        Ok(Self { _worker: worker })
    }
}

pub async fn start_dmesg_driver<T: StationEngine>(
    normfs: Arc<NormFS>,
    station_engine: Arc<T>,
) -> Result<Arc<DmesgDriver>, Box<dyn std::error::Error>> {
    let driver = DmesgDriver::new(normfs, station_engine).await?;
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
            error!("Failed to encode dmesg envelope: {}", err);
            return;
        }

        if let Err(err) = self.normfs.enqueue(&self.queue_id, Bytes::from(buffer)) {
            error!("Failed to enqueue dmesg envelope: {}", err);
        }
    }

    fn publish_signal(&self, signal_type: DmesgSignalType) {
        self.publish(new_envelope(signal_type));
    }

    fn publish_error(&self, signal_type: DmesgSignalType, error: String) {
        let mut envelope = new_envelope(signal_type);
        envelope.error = error;
        self.publish(envelope);
    }

    fn publish_records(&self, records: Vec<String>, from_backlog: bool, dropped: u64) {
        let mut envelope = new_envelope(DmesgSignalType::DmesgMessages);
        envelope.records = records;
        envelope.from_backlog = from_backlog;
        envelope.dropped_records = dropped;
        self.publish(envelope);
    }

    fn publish_gap(&self) {
        self.publish(new_envelope(DmesgSignalType::DmesgGap));
    }
}

fn new_envelope(signal_type: DmesgSignalType) -> RxEnvelope {
    RxEnvelope {
        monotonic_stamp_ns: systime::get_monotonic_stamp_ns(),
        local_stamp_ns: systime::get_local_stamp_ns(),
        app_start_id: systime::get_app_start_id(),
        signal_type: signal_type as i32,
        ..Default::default()
    }
}

fn run(publisher: Publisher) {
    publisher.publish_signal(DmesgSignalType::DmesgStarted);

    if !SUPPORTED {
        info!("dmesg is not available on {}", std::env::consts::OS);
        publisher.publish_error(
            DmesgSignalType::DmesgSourceUnavailable,
            format!(
                "dmesg watching is not available on {}",
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
                    error!("dmesg cannot read {}: {}", KMSG_PATH, err);
                    publisher
                        .publish_error(DmesgSignalType::DmesgSourceUnavailable, err.to_string());
                    unavailable_reported = true;
                }
            }
        }

        thread::sleep(RETRY_INTERVAL);
    }
}

fn follow(mut source: KmsgSource, publisher: &Publisher, replay_backlog: bool) {
    let mut buffer = vec![0u8; RECORD_BUFFER_SIZE];
    let mut batch: Vec<String> = Vec::new();
    let mut dropped: u64 = 0;
    let mut backlog = replay_backlog;
    let mut limiter = RateLimiter::new(MAX_RECORDS_PER_SECOND);

    loop {
        match source.read_record(&mut buffer) {
            ReadOutcome::Record(size) => {
                if !backlog && !limiter.allow() {
                    dropped += 1;
                    continue;
                }

                batch.push(String::from_utf8_lossy(&buffer[..size]).into_owned());

                if batch.len() >= MAX_RECORDS_PER_ENVELOPE {
                    flush(publisher, &mut batch, backlog, &mut dropped);
                }
            }
            ReadOutcome::Drained => {
                flush(publisher, &mut batch, backlog, &mut dropped);

                if backlog {
                    backlog = false;
                    publisher.publish_signal(DmesgSignalType::DmesgBacklogComplete);
                }

                thread::sleep(POLL_INTERVAL);
            }
            ReadOutcome::Overrun => {
                flush(publisher, &mut batch, backlog, &mut dropped);
                publisher.publish_gap();
            }
            ReadOutcome::Oversized => {
                dropped += 1;
            }
            ReadOutcome::Failed(err) => {
                flush(publisher, &mut batch, backlog, &mut dropped);
                error!("dmesg read failed: {}", err);
                publisher.publish_error(DmesgSignalType::DmesgError, err.to_string());
                return;
            }
        }
    }
}

fn flush(publisher: &Publisher, batch: &mut Vec<String>, from_backlog: bool, dropped: &mut u64) {
    if batch.is_empty() && *dropped == 0 {
        return;
    }

    publisher.publish_records(std::mem::take(batch), from_backlog, std::mem::take(dropped));
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
