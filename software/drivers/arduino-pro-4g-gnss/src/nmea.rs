//! NMEA 0183 sentence validation and fix-epoch batching.
//!
//! The EG25-G streams one group of sentences per fix (VTG, GSA, GGA, RMC in
//! current firmware, plus GSV at 1 Hz). Envelopes carry one epoch each, so
//! the batcher groups sentences until it sees a sentence type repeat —
//! except GSV/GSA, which legitimately appear multiple times per epoch
//! (multi-part satellite lists, one GSA per constellation).

/// Returns true when `sentence` is a well-formed `$...*HH` NMEA sentence
/// whose checksum (XOR of the bytes between `$` and `*`) matches.
pub fn validate_nmea_sentence(sentence: &str) -> bool {
    let Some(body) = sentence.strip_prefix('$') else {
        return false;
    };
    let Some((payload, checksum)) = body.rsplit_once('*') else {
        return false;
    };
    let Ok(expected) = u8::from_str_radix(checksum.trim_end(), 16) else {
        return false;
    };
    let actual = payload.bytes().fold(0u8, |acc, b| acc ^ b);
    actual == expected
}

/// Sentences per epoch above which the batch is emitted regardless of
/// boundaries, so a stream that never trips the repeat rule can't grow a
/// batch without bound.
const MAX_EPOCH_SENTENCES: usize = 64;

/// Sentence type (address suffix) of a `$ttSSS,...` sentence: "RMC" for
/// $GPRMC/$GNRMC. Proprietary sentences ($P...) keep their whole address.
fn sentence_type(sentence: &str) -> &str {
    let body = sentence.strip_prefix('$').unwrap_or(sentence);
    let address = body.split(',').next().unwrap_or(body);
    if address.len() == 5 && !address.starts_with('P') {
        &address[2..]
    } else {
        address
    }
}

/// Sentence types that repeat within one epoch: GSV is multi-part and GSA
/// appears once per constellation in multi-GNSS mode. Matched by suffix so
/// Quectel's proprietary BeiDou variants ($PQGSA/$PQGSV, which keep their
/// full address as the type) are covered too.
fn type_repeats_within_epoch(sentence_type: &str) -> bool {
    sentence_type.ends_with("GSV") || sentence_type.ends_with("GSA")
}

/// Groups validated NMEA sentences into fix epochs.
pub struct EpochBatcher {
    sentences: Vec<String>,
}

impl EpochBatcher {
    pub fn new() -> Self {
        EpochBatcher {
            sentences: Vec::new(),
        }
    }

    /// Adds a sentence; returns the completed previous epoch when this
    /// sentence starts a new one.
    pub fn push(&mut self, sentence: &str) -> Option<Vec<String>> {
        let incoming_type = sentence_type(sentence);
        let starts_new_epoch = !type_repeats_within_epoch(incoming_type)
            && self
                .sentences
                .iter()
                .any(|s| sentence_type(s) == incoming_type);

        let completed = if starts_new_epoch || self.sentences.len() >= MAX_EPOCH_SENTENCES {
            self.flush()
        } else {
            None
        };

        self.sentences.push(sentence.to_string());
        completed
    }

    /// Returns whatever is buffered (used on read timeout / disconnect).
    pub fn flush(&mut self) -> Option<Vec<String>> {
        if self.sentences.is_empty() {
            None
        } else {
            Some(std::mem::take(&mut self.sentences))
        }
    }
}

impl Default for EpochBatcher {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_sentence_with_valid_checksum() {
        // Captured verbatim from the EG25-G NMEA port.
        assert!(validate_nmea_sentence("$GPGGA,,,,,,0,,,,,,,,*66"));
        assert!(validate_nmea_sentence("$GPRMC,,V,,,,,,,,,,N,V*29"));
    }

    #[test]
    fn rejects_sentence_with_wrong_checksum() {
        assert!(!validate_nmea_sentence("$GPGGA,,,,,,0,,,,,,,,*67"));
    }

    #[test]
    fn rejects_sentence_without_checksum_or_dollar() {
        assert!(!validate_nmea_sentence("$GPGGA,,,,,,0,,,,,,,,"));
        assert!(!validate_nmea_sentence("GPGGA,,,,,,0,,,,,,,,*66"));
        assert!(!validate_nmea_sentence(""));
    }

    #[test]
    fn splits_epoch_when_a_sentence_type_repeats() {
        let mut batcher = EpochBatcher::new();
        assert_eq!(batcher.push("$GPVTG,a*00"), None);
        assert_eq!(batcher.push("$GPGSA,a*00"), None);
        assert_eq!(batcher.push("$GPGGA,a*00"), None);
        assert_eq!(batcher.push("$GPRMC,a*00"), None);

        // Second VTG starts the next epoch; the first four come back.
        let epoch = batcher.push("$GPVTG,b*00").expect("epoch should close");
        assert_eq!(
            epoch,
            vec!["$GPVTG,a*00", "$GPGSA,a*00", "$GPGGA,a*00", "$GPRMC,a*00"]
        );

        // The new epoch keeps accumulating from the sentence that closed it.
        let epoch = batcher.push("$GPVTG,c*00").expect("epoch should close");
        assert_eq!(epoch, vec!["$GPVTG,b*00"]);
    }

    #[test]
    fn same_type_from_different_talkers_still_splits() {
        let mut batcher = EpochBatcher::new();
        assert_eq!(batcher.push("$GPRMC,a*00"), None);
        let epoch = batcher.push("$GNRMC,b*00").expect("epoch should close");
        assert_eq!(epoch, vec!["$GPRMC,a*00"]);
    }

    #[test]
    fn multi_part_gsv_and_per_constellation_gsa_stay_in_one_epoch() {
        let mut batcher = EpochBatcher::new();
        assert_eq!(batcher.push("$GPGGA,a*00"), None);
        assert_eq!(batcher.push("$GPGSA,a*00"), None);
        assert_eq!(batcher.push("$GLGSA,a*00"), None);
        assert_eq!(batcher.push("$GPGSV,1*00"), None);
        assert_eq!(batcher.push("$GPGSV,2*00"), None);
        assert_eq!(batcher.push("$GLGSV,1*00"), None);
        assert_eq!(batcher.push("$GPRMC,a*00"), None);

        let epoch = batcher.push("$GPGGA,b*00").expect("epoch should close");
        assert_eq!(epoch.len(), 7);
    }

    #[test]
    fn quectel_proprietary_beidou_sentences_stay_in_one_epoch() {
        // With BeiDou NMEA output enabled the EG25-G emits proprietary
        // $PQGSA/$PQGSV sentences, several per epoch back to back.
        let mut batcher = EpochBatcher::new();
        assert_eq!(batcher.push("$GPGGA,a*00"), None);
        assert_eq!(batcher.push("$GPRMC,a*00"), None);
        assert_eq!(batcher.push("$GPGSA,a*00"), None);
        assert_eq!(batcher.push("$PQGSA,1*00"), None);
        assert_eq!(batcher.push("$PQGSA,2*00"), None);
        assert_eq!(batcher.push("$PQGSV,1*00"), None);
        assert_eq!(batcher.push("$PQGSV,2*00"), None);

        let epoch = batcher.push("$GPGGA,b*00").expect("epoch should close");
        assert_eq!(epoch.len(), 7);
    }

    #[test]
    fn flush_returns_pending_sentences_once() {
        let mut batcher = EpochBatcher::new();
        assert_eq!(batcher.push("$GPGGA,a*00"), None);
        assert_eq!(batcher.flush(), Some(vec!["$GPGGA,a*00".to_string()]));
        assert_eq!(batcher.flush(), None);
    }

    #[test]
    fn runaway_stream_without_boundaries_is_capped() {
        let mut batcher = EpochBatcher::new();
        let mut emitted = None;
        for i in 0..200 {
            // GSV never triggers the repeat rule, so only the cap can flush.
            if let Some(batch) = batcher.push(&format!("$GPGSV,{i}*00")) {
                emitted = Some(batch);
                break;
            }
        }
        let batch = emitted.expect("cap should have flushed the batch");
        assert!(batch.len() <= 64);
    }
}
