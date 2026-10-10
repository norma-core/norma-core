/// About a second of frames per chain bounds what a jump back has to decode.
pub const KEYFRAME_INTERVAL_NS: u64 = 1_000_000_000;

/// Bounds a chain by count too, in case the monotonic stamp stops moving.
const KEYFRAME_MAX_FRAMES: u64 = 120;

/// Where the current chain starts, and when the next frame must start a new
/// one. The interval runs on the monotonic stamp, since frame counts drift with
/// drops and `frame_skip`; the frame count is only the backstop.
#[derive(Debug, Default, Clone)]
pub struct KeyframePolicy {
    keyframe: Option<u64>,
    keyframe_at_ns: u64,
    since_keyframe: u64,
    broken: bool,
}

impl KeyframePolicy {
    pub fn wants_keyframe(&self, now_ns: u64) -> bool {
        self.broken
            || self.keyframe.is_none()
            || now_ns.saturating_sub(self.keyframe_at_ns) >= KEYFRAME_INTERVAL_NS
            || self.since_keyframe >= KEYFRAME_MAX_FRAMES
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
        for id in 1..=KEYFRAME_MAX_FRAMES {
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
    fn a_p_frame_landing_does_not_move_the_chain() {
        let mut p = KeyframePolicy::default();
        p.landed(4, true, 0);
        p.landed(5, false, 10 * MS);
        assert_eq!(p.keyframe(), Some(4));
    }
}
