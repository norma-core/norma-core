//! Enqueue helpers with an explicit backpressure policy.
//!
//! `NormFS::enqueue` waits for a free page; `try_enqueue` returns
//! `WouldBlock` instead. The policy is chosen per record: periodic data
//! (frames, telemetry, state snapshots) is superseded by the next record and
//! may be skipped, while one-off records (connect, disconnect, registrations,
//! command echoes) must be kept.
//!
//! Async tasks wait with a timeout. Subscriber callbacks run under the
//! source queue's append gate and capture threads must not stall, so those
//! try once and log a refusal.

use std::time::Duration;

use bytes::Bytes;
use normfs::{NormFS, QueueId};

pub const WRITE_TIMEOUT: Duration = Duration::from_secs(5);

/// Startup records get a longer timeout: nothing can be read without them.
pub const STARTUP_WRITE_TIMEOUT: Duration = Duration::from_secs(30);

/// What to do when the queue has no free page.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Backpressure {
    /// Wait if possible; otherwise report the drop.
    Keep,
    /// Drop silently; the next record supersedes this one.
    Skip,
}

/// Enqueues from an async context. `Keep` waits up to [`WRITE_TIMEOUT`].
pub async fn enqueue_with(
    normfs: &NormFS,
    queue_id: &QueueId,
    data: Bytes,
    policy: Backpressure,
) -> Result<(), normfs::Error> {
    match policy {
        Backpressure::Skip => try_enqueue_with(normfs, queue_id, data, policy),
        Backpressure::Keep => enqueue_waiting(normfs, queue_id, data, WRITE_TIMEOUT).await,
    }
}

/// Enqueues from an async context, waiting up to `wait` for a free page.
pub async fn enqueue_waiting(
    normfs: &NormFS,
    queue_id: &QueueId,
    data: Bytes,
    wait: Duration,
) -> Result<(), normfs::Error> {
    match tokio::time::timeout(wait, normfs.enqueue(queue_id, data)).await {
        Ok(outcome) => outcome.map(|_| ()),
        Err(_) => Err(normfs::Error::Io(std::io::Error::new(
            std::io::ErrorKind::TimedOut,
            "no page became free in time",
        ))),
    }
}

/// Enqueues without waiting. A full queue is `Ok(())` for `Skip` and
/// `Err(WouldBlock)` for `Keep`.
pub fn try_enqueue_with(
    normfs: &NormFS,
    queue_id: &QueueId,
    data: Bytes,
    policy: Backpressure,
) -> Result<(), normfs::Error> {
    match normfs.try_enqueue(queue_id, data) {
        Ok(_) => Ok(()),
        Err(normfs::Error::WouldBlock) if policy == Backpressure::Skip => Ok(()),
        Err(e) => Err(e),
    }
}
