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
const RESUME_SCAN_ENTRIES: u64 = 32;

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

        let resume_after = if SUPPORTED {
            info!("dmesg watching {}", KMSG_PATH);
            last_published_record(&normfs, &queue_id).await
        } else {
            None
        };

        let publisher = Publisher { normfs, queue_id };
        let worker = thread::Builder::new()
            .name("dmesg".to_string())
            .spawn(move || run(publisher, resume_after))?;

        Ok(Self { _worker: worker })
    }
}

async fn last_published_record(normfs: &Arc<NormFS>, queue_id: &QueueId) -> Option<String> {
    normfs.get_last_id(queue_id).ok()?;

    let (tx, mut rx) = tokio::sync::mpsc::channel(RESUME_SCAN_ENTRIES as usize);
    let offset = normfs::UintN::from(RESUME_SCAN_ENTRIES - 1);

    if let Err(err) = normfs
        .read(
            queue_id,
            normfs::ReadPosition::ShiftFromTail(offset),
            RESUME_SCAN_ENTRIES,
            1,
            tx,
        )
        .await
    {
        error!("dmesg could not read back {}: {}", QUEUE_ID, err);
        return None;
    }

    let mut newest = None;

    while let Some(entry) = rx.recv().await {
        if let Ok(envelope) = RxEnvelope::decode(entry.data.as_ref())
            && let Some(last) = envelope.records.last()
        {
            newest = Some(last.clone());
        }
    }

    newest
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

fn run(publisher: Publisher, resume_after: Option<String>) {
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
                let resume_after = if replay_backlog {
                    resume_after.as_deref()
                } else {
                    None
                };
                follow(source, &publisher, replay_backlog, resume_after);
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

fn follow(
    mut source: KmsgSource,
    publisher: &Publisher,
    replay_backlog: bool,
    resume_after: Option<&str>,
) {
    let mut buffer = vec![0u8; RECORD_BUFFER_SIZE];
    let mut batch: Vec<String> = Vec::new();
    let mut dropped: u64 = 0;
    let mut backlog = replay_backlog;
    let mut pending_gap = false;
    let mut limiter = RateLimiter::new(MAX_RECORDS_PER_SECOND);

    loop {
        match source.read_record(&mut buffer) {
            ReadOutcome::Record(size) => {
                if !backlog && !limiter.allow() {
                    dropped += 1;
                    continue;
                }

                batch.push(String::from_utf8_lossy(&buffer[..size]).into_owned());

                if !backlog && batch.len() >= MAX_RECORDS_PER_ENVELOPE {
                    flush(publisher, &mut batch, backlog, &mut dropped);
                }
            }
            ReadOutcome::Drained => {
                if backlog {
                    backlog = false;
                    publish_backlog(
                        publisher,
                        std::mem::take(&mut batch),
                        resume_after,
                        std::mem::take(&mut dropped),
                    );
                    if std::mem::take(&mut pending_gap) {
                        publisher.publish_gap();
                    }
                    publisher.publish_signal(DmesgSignalType::DmesgBacklogComplete);
                } else {
                    flush(publisher, &mut batch, backlog, &mut dropped);
                }

                thread::sleep(POLL_INTERVAL);
            }
            ReadOutcome::Overrun => {
                if backlog {
                    pending_gap = true;
                } else {
                    flush(publisher, &mut batch, backlog, &mut dropped);
                    publisher.publish_gap();
                }
            }
            ReadOutcome::Oversized => {
                dropped += 1;
            }
            ReadOutcome::Failed(err) => {
                if backlog {
                    publish_backlog(
                        publisher,
                        std::mem::take(&mut batch),
                        resume_after,
                        std::mem::take(&mut dropped),
                    );
                    if std::mem::take(&mut pending_gap) {
                        publisher.publish_gap();
                    }
                } else {
                    flush(publisher, &mut batch, backlog, &mut dropped);
                }
                error!("dmesg read failed: {}", err);
                publisher.publish_error(DmesgSignalType::DmesgError, err.to_string());
                return;
            }
        }
    }
}

fn publish_backlog(
    publisher: &Publisher,
    records: Vec<String>,
    resume_after: Option<&str>,
    dropped: u64,
) {
    let start = match resume_after {
        Some(marker) => match records.iter().rposition(|record| record == marker) {
            Some(index) => {
                info!(
                    "dmesg resuming after last published record, skipping {} of {} backlog records",
                    index + 1,
                    records.len()
                );
                index + 1
            }
            None => {
                info!(
                    "dmesg last published record is no longer in the ring buffer, replaying all {} backlog records",
                    records.len()
                );
                0
            }
        },
        None => {
            info!("dmesg replaying all {} backlog records", records.len());
            0
        }
    };

    let mut dropped = dropped;

    for chunk in records[start..].chunks(MAX_RECORDS_PER_ENVELOPE) {
        publisher.publish_records(chunk.to_vec(), true, std::mem::take(&mut dropped));
    }

    if dropped > 0 {
        publisher.publish_records(Vec::new(), true, dropped);
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
