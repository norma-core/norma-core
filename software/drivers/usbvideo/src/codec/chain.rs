use std::collections::HashMap;
use std::sync::Arc;

use normfs::{NormFS, QueueId, ReadPosition, UintN};
use prost::Message;

use super::{DecodedFrame, VideoDecoder, Vp8Decoder};
use crate::usbvideo_proto::{
    frame::FrameFormatKind,
    usbvideo::{RxEnvelope, RxEnvelopeType},
};

/// A keyframe is placed about once a second, so a chain this long means the
/// keyframe policy is broken; refuse rather than decode minutes of video.
const MAX_CHAIN: u64 = 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChainError {
    /// The entry is not a VP8 frame.
    NotVp8,
    /// The chain's keyframe entry is not a keyframe.
    NoKeyframe(u64),
    /// An entry between the keyframe and the target was not there.
    Gap {
        expected: u64,
        got: Option<u64>,
    },
    /// A frame inside the range belongs to another chain.
    Foreign(u64),
    TooLong(u64),
    Decode(String),
    Read(String),
}

impl std::fmt::Display for ChainError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ChainError::NotVp8 => write!(f, "not a VP8 frame"),
            ChainError::NoKeyframe(id) => write!(f, "entry {id} is not a keyframe"),
            ChainError::Gap { expected, got } => {
                write!(f, "expected entry {expected}, got {got:?}")
            }
            ChainError::Foreign(id) => write!(f, "entry {id} belongs to another chain"),
            ChainError::TooLong(n) => write!(f, "chain of {n} entries is too long"),
            ChainError::Decode(e) => write!(f, "decode: {e}"),
            ChainError::Read(e) => write!(f, "read: {e}"),
        }
    }
}

impl std::error::Error for ChainError {}

/// The keyframe entry the VP8 frame at `id` decodes from.
pub fn keyframe_of(id: u64, envelope: &RxEnvelope) -> Result<u64, ChainError> {
    let pack = envelope.frames.as_ref().ok_or(ChainError::NotVp8)?;
    let kind = pack.format.as_ref().map(|f| f.kind());
    if envelope.r#type() != RxEnvelopeType::EtFrames || kind != Some(FrameFormatKind::FfVp8) {
        return Err(ChainError::NotVp8);
    }
    if pack.keyframe {
        return Ok(id);
    }
    UintN::read_value_from_slice(&pack.keyframe_ptr, pack.keyframe_ptr.len())
        .ok()
        .and_then(|k| k.to_u64().ok())
        .filter(|k| *k < id)
        .ok_or(ChainError::NoKeyframe(id))
}

/// Decodes `entries`, in id order, up to `target`. They start at `keyframe`,
/// or right after `resumed_after` when `decoder` already holds the chain up
/// to that entry. Any hole or frame of another chain is an error, never a
/// picture of the wrong frame.
pub fn decode_chain(
    decoder: &mut dyn VideoDecoder,
    entries: &[(u64, RxEnvelope)],
    keyframe: u64,
    target: u64,
    resumed_after: Option<u64>,
) -> Result<DecodedFrame, ChainError> {
    let mut expected = resumed_after.map_or(keyframe, |last| last + 1);
    for (id, envelope) in entries {
        if *id != expected {
            return Err(ChainError::Gap {
                expected,
                got: Some(*id),
            });
        }
        expected += 1;
        if envelope.r#type() != RxEnvelopeType::EtFrames {
            if *id == target {
                return Err(ChainError::NotVp8);
            }
            continue;
        }
        let chain = keyframe_of(*id, envelope).map_err(|_| ChainError::Foreign(*id))?;
        if *id == keyframe && chain != keyframe {
            return Err(ChainError::NoKeyframe(keyframe));
        }
        if chain != keyframe {
            return Err(ChainError::Foreign(*id));
        }
        let packet = envelope
            .frames
            .as_ref()
            .and_then(|p| p.frames_data.first())
            .ok_or(ChainError::Foreign(*id))?;
        let frame = decoder.decode(packet).map_err(ChainError::Decode)?;
        if *id == target {
            return Ok(frame);
        }
    }
    Err(ChainError::Gap {
        expected,
        got: None,
    })
}

struct Cursor {
    keyframe: u64,
    last: u64,
    frame: DecodedFrame,
    decoder: Box<dyn VideoDecoder>,
}

/// Decodes VP8 frames by entry id. A queue read forward one frame at a time,
/// as live view and inference do, costs one decode per frame; a jump costs at
/// most the frames back to its keyframe.
pub struct FrameReader {
    normfs: Arc<NormFS>,
    cursors: tokio::sync::Mutex<HashMap<String, Cursor>>,
}

impl FrameReader {
    pub fn new(normfs: Arc<NormFS>) -> Self {
        Self {
            normfs,
            cursors: tokio::sync::Mutex::new(HashMap::new()),
        }
    }

    /// The picture of the frame at `id`, whose envelope the caller has read.
    pub async fn frame_at(
        &self,
        queue: &QueueId,
        id: u64,
        envelope: &RxEnvelope,
    ) -> Result<DecodedFrame, ChainError> {
        let keyframe = keyframe_of(id, envelope)?;
        if id - keyframe >= MAX_CHAIN {
            return Err(ChainError::TooLong(id - keyframe + 1));
        }
        let mut cursors = self.cursors.lock().await;
        let key = queue.to_string();
        let resume = cursors
            .remove(&key)
            .filter(|c| c.keyframe == keyframe && c.last <= id);
        let (from, resumed_after, mut decoder) = match resume {
            Some(c) if c.last == id => {
                let frame = c.frame.clone();
                cursors.insert(key, c);
                return Ok(frame);
            }
            Some(c) => (c.last + 1, Some(c.last), c.decoder),
            None => (
                keyframe,
                None,
                Box::new(Vp8Decoder::new().map_err(ChainError::Decode)?) as Box<dyn VideoDecoder>,
            ),
        };
        let entries = self.read(queue, from, id).await?;
        let frame = decode_chain(decoder.as_mut(), &entries, keyframe, id, resumed_after)?;
        cursors.insert(
            key,
            Cursor {
                keyframe,
                last: id,
                frame: frame.clone(),
                decoder,
            },
        );
        Ok(frame)
    }

    async fn read(
        &self,
        queue: &QueueId,
        from: u64,
        to: u64,
    ) -> Result<Vec<(u64, RxEnvelope)>, ChainError> {
        let count = to - from + 1;
        let (tx, mut rx) = tokio::sync::mpsc::channel(count as usize + 1);
        self.normfs
            .read(
                queue,
                ReadPosition::Absolute(UintN::from(from)),
                count,
                1,
                tx,
            )
            .await
            .map_err(|e| ChainError::Read(e.to_string()))?;
        let mut entries = Vec::with_capacity(count as usize);
        while let Some(entry) = rx.recv().await {
            let id = entry
                .id
                .to_u64()
                .map_err(|e| ChainError::Read(e.to_string()))?;
            let envelope =
                RxEnvelope::decode(entry.data).map_err(|e| ChainError::Read(e.to_string()))?;
            entries.push((id, envelope));
        }
        Ok(entries)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codec::test_frames::camera_like;
    use crate::codec::{VideoEncoder, Vp8Encoder};
    use crate::usbvideo_proto::frame::{FrameFormat, FramesPack};
    use bytes::Bytes;

    fn vp8_entry(id: u64, packet: Vec<u8>, keyframe: Option<u64>) -> (u64, RxEnvelope) {
        let envelope = RxEnvelope {
            r#type: RxEnvelopeType::EtFrames as i32,
            frames: Some(FramesPack {
                format: Some(FrameFormat {
                    width: 32,
                    height: 32,
                    kind: FrameFormatKind::FfVp8 as i32,
                }),
                frames_data: vec![Bytes::from(packet)],
                keyframe: keyframe.is_none(),
                keyframe_ptr: keyframe.map_or_else(Bytes::new, |k| UintN::from(k).value_to_bytes()),
                ..Default::default()
            }),
            ..Default::default()
        };
        (id, envelope)
    }

    /// A chain of `n` frames whose keyframe is entry `first`.
    fn chain(first: u64, n: u64) -> Vec<(u64, RxEnvelope)> {
        let mut enc = Vp8Encoder::new(32, 32).unwrap();
        (0..n)
            .map(|i| {
                let p = enc
                    .encode(&camera_like(32, 32, i as usize), i == 0)
                    .unwrap();
                vp8_entry(first + i, p.data, (i > 0).then_some(first))
            })
            .collect()
    }

    fn decode(
        entries: &[(u64, RxEnvelope)],
        keyframe: u64,
        target: u64,
    ) -> Result<DecodedFrame, ChainError> {
        let mut decoder = Vp8Decoder::new().unwrap();
        decode_chain(&mut decoder, entries, keyframe, target, None)
    }

    #[test]
    fn a_whole_chain_decodes_to_its_target() {
        let entries = chain(10, 5);
        assert!(decode(&entries, 10, 14).is_ok());
        assert_eq!(keyframe_of(14, &entries[4].1), Ok(10));
        assert_eq!(keyframe_of(10, &entries[0].1), Ok(10));
    }

    #[test]
    fn a_missing_entry_is_a_gap_not_a_picture() {
        let mut entries = chain(10, 5);
        entries.remove(2);
        assert_eq!(
            decode(&entries, 10, 14),
            Err(ChainError::Gap {
                expected: 12,
                got: Some(13)
            })
        );
    }

    #[test]
    fn a_chain_cut_short_is_a_gap() {
        let entries = chain(10, 3);
        assert_eq!(
            decode(&entries, 10, 14),
            Err(ChainError::Gap {
                expected: 13,
                got: None
            })
        );
    }

    #[test]
    fn a_frame_of_another_chain_is_refused() {
        let mut entries = chain(10, 3);
        let other = chain(0, 2);
        entries.push((13, other[1].1.clone()));
        assert_eq!(decode(&entries, 10, 13), Err(ChainError::Foreign(13)));
    }

    #[test]
    fn a_keyframe_entry_that_is_not_a_keyframe_is_refused() {
        let entries = chain(10, 4);
        assert_eq!(
            decode(&entries[1..], 11, 13),
            Err(ChainError::NoKeyframe(11))
        );
    }

    #[test]
    fn session_events_inside_a_chain_are_skipped() {
        let mut entries = chain(10, 4);
        for (id, _) in entries.iter_mut().skip(2) {
            *id += 1;
        }
        entries.insert(
            2,
            (
                12,
                RxEnvelope {
                    r#type: RxEnvelopeType::EtDeviceConnected as i32,
                    ..Default::default()
                },
            ),
        );
        assert!(decode(&entries, 10, 14).is_ok());
        assert_eq!(decode(&entries, 10, 12), Err(ChainError::NotVp8));
    }

    #[test]
    fn a_jpeg_entry_has_no_chain() {
        let envelope = RxEnvelope {
            r#type: RxEnvelopeType::EtFrames as i32,
            frames: Some(FramesPack {
                format: Some(FrameFormat {
                    kind: FrameFormatKind::FfJpeg as i32,
                    ..Default::default()
                }),
                ..Default::default()
            }),
            ..Default::default()
        };
        assert_eq!(keyframe_of(5, &envelope), Err(ChainError::NotVp8));
    }
}
