use hyper::HeaderMap;

/// Supported content encodings for serving compressed assets
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Encoding {
    Identity,
    Gzip,
}

impl Encoding {
    fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "identity" => Some(Encoding::Identity),
            "gzip" => Some(Encoding::Gzip),
            _ => None,
        }
    }
}

/// Represents a single encoding with its quality value
#[derive(Debug, Clone)]
struct EncodingWithQuality {
    encoding: Option<Encoding>, // None represents wildcard "*"
    quality: f32,
}

/// Parse a single Accept-Encoding value with optional quality parameter
/// Example: "gzip;q=0.8" -> EncodingWithQuality { encoding: Gzip, quality: 0.8 }
fn parse_encoding_with_quality(value: &str) -> Option<EncodingWithQuality> {
    let value = value.trim();
    let parts: Vec<&str> = value.split(';').collect();

    if parts.is_empty() {
        return None;
    }

    let encoding_str = parts[0].trim();
    let encoding = if encoding_str == "*" {
        None // Wildcard
    } else {
        match Encoding::from_str(encoding_str) {
            Some(enc) => Some(enc),
            None => return None, // Unknown encoding, skip it
        }
    };

    let mut quality = 1.0;

    // Look for q parameter
    for part in parts.iter().skip(1) {
        let part = part.trim();
        if let Some(q_value) = part.strip_prefix("q=").or_else(|| part.strip_prefix("Q=")) {
            match q_value.trim().parse::<f32>() {
                Ok(q) if (0.0..=1.0).contains(&q) => quality = q,
                _ => return None, // Invalid q-value
            }
        }
    }

    Some(EncodingWithQuality { encoding, quality })
}

/// Parse the Accept-Encoding header and return a list of encodings with their quality values
fn parse_accept_encoding(headers: &HeaderMap) -> Vec<EncodingWithQuality> {
    let mut encodings = Vec::new();

    // Get all Accept-Encoding headers (there can be multiple)
    for header_value in headers.get_all(hyper::header::ACCEPT_ENCODING) {
        if let Ok(value_str) = header_value.to_str() {
            // Split by comma for multiple encodings in one header
            for encoding_part in value_str.split(',') {
                if let Some(enc_with_q) = parse_encoding_with_quality(encoding_part) {
                    encodings.push(enc_with_q);
                }
            }
        }
    }

    encodings
}

/// Negotiate the best encoding based on client preferences and available encodings
///
/// # Arguments
/// * `headers` - HTTP request headers containing Accept-Encoding
/// * `available_encodings` - List of encodings available for the requested file
///
/// # Returns
/// The best encoding to use based on client preferences and availability
pub fn negotiate_encoding(headers: &HeaderMap, available_encodings: &[Encoding]) -> Encoding {
    let client_prefs = parse_accept_encoding(headers);

    // If no Accept-Encoding header or parsing failed, return best available
    if client_prefs.is_empty() {
        return prefer_best_available(available_encodings);
    }

    // Build a list of (encoding, quality) for available encodings
    let mut candidates: Vec<(Encoding, f32)> = Vec::new();

    for &available in available_encodings {
        let mut max_quality = 0.0f32;
        let mut found = false;

        for client_pref in &client_prefs {
            match client_pref.encoding {
                Some(enc) if enc == available => {
                    // Exact match
                    max_quality = max_quality.max(client_pref.quality);
                    found = true;
                }
                None => {
                    // Wildcard match
                    max_quality = max_quality.max(client_pref.quality);
                    found = true;
                }
                _ => {}
            }
        }

        // Check if encoding was explicitly rejected (q=0)
        let explicitly_rejected = client_prefs.iter().any(
            |pref| matches!(pref.encoding, Some(enc) if enc == available && pref.quality == 0.0),
        );

        if found && !explicitly_rejected && max_quality > 0.0 {
            candidates.push((available, max_quality));
        }
    }

    // Identity is implicitly acceptable unless explicitly rejected
    // If Identity is available and not in candidates, add it with default quality
    if available_encodings.contains(&Encoding::Identity) {
        let identity_explicitly_mentioned = client_prefs
            .iter()
            .any(|pref| matches!(pref.encoding, Some(Encoding::Identity)));
        let identity_explicitly_rejected = client_prefs
            .iter()
            .any(|pref| matches!(pref.encoding, Some(Encoding::Identity)) && pref.quality == 0.0);

        if !identity_explicitly_mentioned && !identity_explicitly_rejected {
            // Identity is implicitly acceptable with low priority
            candidates.push((Encoding::Identity, 0.001));
        }
    }

    // Sort by quality (descending), then by encoding preference (Gzip > Identity)
    candidates.sort_by(|a, b| {
        b.1.partial_cmp(&a.1)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| encoding_preference_order(&b.0).cmp(&encoding_preference_order(&a.0)))
    });

    // Return the best candidate, or fall back to best available
    candidates
        .first()
        .map(|(enc, _)| *enc)
        .unwrap_or_else(|| prefer_best_available(available_encodings))
}

/// Return preference order for tie-breaking (higher is better)
fn encoding_preference_order(encoding: &Encoding) -> u8 {
    match encoding {
        Encoding::Gzip => 2,
        Encoding::Identity => 1,
    }
}

/// When no client preference is specified, prefer the best available encoding
fn prefer_best_available(available: &[Encoding]) -> Encoding {
    if available.contains(&Encoding::Gzip) {
        Encoding::Gzip
    } else {
        Encoding::Identity
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use hyper::header::{ACCEPT_ENCODING, HeaderMap, HeaderValue};

    fn make_headers(accept_encoding: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            ACCEPT_ENCODING,
            HeaderValue::from_str(accept_encoding).unwrap(),
        );
        headers
    }

    #[test]
    fn test_no_accept_encoding_header() {
        let headers = HeaderMap::new();
        let available = vec![Encoding::Gzip, Encoding::Identity];
        assert_eq!(negotiate_encoding(&headers, &available), Encoding::Gzip);
    }

    #[test]
    fn test_wildcard() {
        let headers = make_headers("*");
        let available = vec![Encoding::Gzip, Encoding::Identity];
        assert_eq!(negotiate_encoding(&headers, &available), Encoding::Gzip);
    }

    #[test]
    fn test_only_identity_available() {
        let headers = make_headers("gzip");
        let available = vec![Encoding::Identity];
        assert_eq!(negotiate_encoding(&headers, &available), Encoding::Identity);
    }

    #[test]
    fn test_case_insensitive() {
        let headers = make_headers("GZIP");
        let available = vec![Encoding::Gzip];
        assert_eq!(negotiate_encoding(&headers, &available), Encoding::Gzip);
    }

    #[test]
    fn test_malformed_header() {
        let headers = make_headers("gzip;q=invalid, gzip");
        let available = vec![Encoding::Gzip];
        // gzip (unsupported) with invalid q should be ignored, gzip should be selected
        assert_eq!(negotiate_encoding(&headers, &available), Encoding::Gzip);
    }

    #[test]
    fn test_only_identity_requested() {
        let headers = make_headers("identity");
        let available = vec![Encoding::Gzip, Encoding::Identity];
        assert_eq!(negotiate_encoding(&headers, &available), Encoding::Identity);
    }

    #[test]
    fn test_explicit_rejection() {
        let headers = make_headers("gzip;q=0");
        let available = vec![Encoding::Gzip, Encoding::Identity];
        assert_eq!(negotiate_encoding(&headers, &available), Encoding::Identity);
    }

    #[test]
    fn test_quality_values() {
        let headers = make_headers("gzip;q=0.5, identity;q=0.8");
        let available = vec![Encoding::Gzip, Encoding::Identity];
        assert_eq!(negotiate_encoding(&headers, &available), Encoding::Identity);
    }

    #[test]
    fn test_gzip_explicitly_requested() {
        // Test the most common browser scenario: Accept-Encoding: gzip
        let headers = make_headers("gzip");
        let available = vec![Encoding::Gzip, Encoding::Identity];
        assert_eq!(negotiate_encoding(&headers, &available), Encoding::Gzip);
    }

    #[test]
    fn test_gzip_with_unknown_encodings() {
        // Browsers often send: Accept-Encoding: gzip, deflate, br
        // We don't support deflate, but should still select gzip
        let headers = make_headers("gzip, deflate, br");
        let available = vec![Encoding::Gzip, Encoding::Identity];
        assert_eq!(negotiate_encoding(&headers, &available), Encoding::Gzip);
    }
}
