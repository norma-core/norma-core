use std::time::Duration;

/// About a second of frames per chain bounds what a jump back has to decode.
pub const KEYFRAME_INTERVAL: Duration = Duration::from_secs(1);

/// The longest interval taken. The viewer decodes a whole chain to show a
/// frame, within a 2 s output wait and a 4 s live lag.
pub const KEYFRAME_INTERVAL_MAX: Duration = Duration::from_secs(5);

/// Bounds a chain by count too, in case the monotonic stamp stops moving:
/// this many frames per second of interval.
const KEYFRAME_FRAMES_PER_SECOND: u64 = 120;

/// Where the current chain starts, and when the next frame must start a new
/// one. The interval runs on the monotonic stamp, since frame counts drift with
/// drops and `frame_skip`; the frame count is only the backstop.
#[derive(Debug, Clone)]
pub struct KeyframePolicy {
    interval_ns: u64,
    max_frames: u64,
    keyframe: Option<u64>,
    keyframe_at_ns: u64,
    since_keyframe: u64,
    broken: bool,
}

impl Default for KeyframePolicy {
    fn default() -> Self {
        Self::new(KEYFRAME_INTERVAL)
    }
}

impl KeyframePolicy {
    pub fn new(interval: Duration) -> Self {
        // Zero would make every frame a keyframe; it means the default.
        let interval = if interval.is_zero() {
            KEYFRAME_INTERVAL
        } else {
            interval
        };
        let interval_ns = interval.min(KEYFRAME_INTERVAL_MAX).as_nanos() as u64;
        let seconds = interval_ns.div_ceil(1_000_000_000).max(1);
        Self {
            interval_ns,
            max_frames: seconds * KEYFRAME_FRAMES_PER_SECOND,
            keyframe: None,
            keyframe_at_ns: 0,
            since_keyframe: 0,
            broken: false,
        }
    }

    pub fn wants_keyframe(&self, now_ns: u64) -> bool {
        self.broken
            || self.keyframe.is_none()
            || now_ns.saturating_sub(self.keyframe_at_ns) >= self.interval_ns
            || self.since_keyframe >= self.max_frames
    }

    /// The keyframe entry a P frame written now names.
    pub fn keyframe(&self) -> Option<u64> {
        self.keyframe
    }

    pub fn landed(&mut self, id: u64, keyframe: bool, now_ns: u64) {
        if keyframe {
            self.keyframe = Some(id);
            self.keyframe_at_ns = now_ns;
            self.since_keyframe = 0;
            self.broken = false;
        } else {
            self.since_keyframe += 1;
        }
    }

    /// The encoder moved past a frame no reader will see, so the frames it
    /// encodes next reference a picture missing from the queue.
    pub fn lost(&mut self) {
        self.broken = true;
        self.keyframe = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MS: u64 = 1_000_000;

    #[test]
    fn the_first_frame_is_a_keyframe() {
        assert!(KeyframePolicy::default().wants_keyframe(0));
    }

    #[test]
    fn a_keyframe_comes_again_after_a_second() {
        let mut p = KeyframePolicy::default();
        p.landed(10, true, 5_000 * MS);
        assert!(!p.wants_keyframe(5_000 * MS + 999 * MS));
        assert!(p.wants_keyframe(5_000 * MS + 1_000 * MS));
        assert_eq!(p.keyframe(), Some(10));
    }

    #[test]
    fn a_frozen_stamp_still_gets_keyframes() {
        let mut p = KeyframePolicy::default();
        p.landed(0, true, 7 * MS);
        for id in 1..=KEYFRAME_FRAMES_PER_SECOND {
            assert!(!p.wants_keyframe(7 * MS), "frame {id}");
            p.landed(id, false, 7 * MS);
        }
        assert!(p.wants_keyframe(7 * MS));
    }

    #[test]
    fn a_lost_frame_forces_a_keyframe_next() {
        let mut p = KeyframePolicy::default();
        p.landed(10, true, 0);
        p.landed(11, false, 33 * MS);
        p.lost();
        assert!(p.wants_keyframe(66 * MS));
        assert_eq!(p.keyframe(), None);
        p.landed(13, true, 99 * MS);
        assert!(!p.wants_keyframe(132 * MS));
        assert_eq!(p.keyframe(), Some(13));
    }

    #[test]
    fn a_longer_interval_spaces_keyframes_and_keeps_chains_bounded() {
        let mut p = KeyframePolicy::new(Duration::from_secs(5));
        p.landed(0, true, 0);
        assert!(!p.wants_keyframe(4_999 * MS));
        assert!(p.wants_keyframe(5_000 * MS));

        let mut p = KeyframePolicy::new(Duration::from_secs(60));
        p.landed(0, true, 0);
        assert!(p.wants_keyframe(5_000 * MS));
        let frames = 5 * KEYFRAME_FRAMES_PER_SECOND;
        for id in 1..frames {
            p.landed(id, false, 0);
        }
        assert!(!p.wants_keyframe(0));
        p.landed(frames, false, 0);
        assert!(p.wants_keyframe(0));

        let mut p = KeyframePolicy::new(Duration::ZERO);
        p.landed(0, true, 0);
        assert!(!p.wants_keyframe(999 * MS));
        assert!(p.wants_keyframe(1_000 * MS));
    }

    #[test]
    fn a_p_frame_landing_does_not_move_the_chain() {
        let mut p = KeyframePolicy::default();
        p.landed(4, true, 0);
        p.landed(5, false, 10 * MS);
        assert_eq!(p.keyframe(), Some(4));
    }
}
